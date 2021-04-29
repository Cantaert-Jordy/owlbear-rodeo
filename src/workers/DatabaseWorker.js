import * as Comlink from "comlink";
import {
  importInto,
  exportDB,
  peakImportFile,
} from "@mitchemmc/dexie-export-import";
import { encode, decode } from "@msgpack/msgpack";

import { getDatabase } from "../database";
import blobToBuffer from "../helpers/blobToBuffer";

// Worker to load large amounts of database data on a separate thread
let service = {
  /**
   * Load either a whole table or individual item from the DB
   * @param {string} table Table to load from
   * @param {string=} key Optional database key to load, if undefined whole table will be loaded
   */
  async loadData(table, key) {
    try {
      let db = getDatabase({});
      if (key) {
        // Load specific item
        const data = await db.table(table).get(key);
        const packed = encode(data);
        return Comlink.transfer(packed, [packed.buffer]);
      } else {
        // Load entire table
        let items = [];
        // Use a cursor instead of toArray to prevent IPC max size error
        await db.table(table).each((item) => {
          items.push(item);
        });

        // Pack data with msgpack so we can use transfer to avoid memory issues
        const packed = encode(items);
        return Comlink.transfer(packed, [packed.buffer]);
      }
    } catch {}
  },

  /**
   * Put data into table encoded by msgpack
   * @param {Uint8Array} data
   * @param {string} table
   */
  async putData(data, table) {
    try {
      let db = getDatabase({});
      const decoded = decode(data);
      await db.table(table).put(decoded);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Export current database
   * @param {function} progressCallback
   * @param {string[]} maps An array of map ids to export
   * @param {string[]} tokens An array of token ids to export
   */
  async exportData(progressCallback, maps, tokens) {
    let db = getDatabase({});

    const filter = (table, value) => {
      if (table === "maps") {
        return maps.includes(value.id);
      }
      if (table === "states") {
        return maps.includes(value.mapId);
      }
      if (table === "tokens") {
        return tokens.includes(value.id);
      }
      return false;
    };

    const data = await exportDB(db, {
      progressCallback,
      filter,
      numRowsPerChunk: 1,
      prettyJson: true,
    });

    const buffer = await blobToBuffer(data);

    return Comlink.transfer(buffer, [buffer.buffer]);
  },

  /**
   * Import into current database
   * @param {Blob} data
   * @param {string} databaseName The name of the database to import into
   * @param {function} progressCallback
   */
  async importData(data, databaseName, progressCallback) {
    const importMeta = await peakImportFile(data);
    if (!importMeta.data) {
      throw new Error("Uanble to parse file");
    }

    let db = getDatabase({});

    if (importMeta.data.databaseName !== db.name) {
      throw new Error("Unable to import database, name mismatch");
    }
    if (importMeta.data.databaseVersion > db.verno) {
      throw new Error(
        `Database version differs. Current database is in version ${db.verno} but export is ${importMeta.data.databaseVersion}`
      );
    }

    // Ensure import DB is cleared before importing new data
    let importDB = getDatabase({ addons: [] }, databaseName, 0);
    await importDB.delete();
    importDB.close();

    // Load import database up to it's desired version
    importDB = getDatabase(
      { addons: [] },
      databaseName,
      importMeta.data.databaseVersion
    );
    await importInto(importDB, data, {
      progressCallback,
      acceptNameDiff: true,
      overwriteValues: true,
      filter: (table, value) => {
        // Ensure values are of the correct form
        if (table === "maps" || table === "tokens") {
          return "id" in value && "owner" in value;
        }
        if (table === "states") {
          return "mapId" in value;
        }
        return true;
      },
      acceptVersionDiff: true,
    });
    importDB.close();
  },
};

Comlink.expose(service);
