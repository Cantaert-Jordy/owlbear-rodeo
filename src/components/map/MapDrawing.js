import React, { useContext, useState, useCallback } from "react";
import shortid from "shortid";
import { Group, Line, Rect, Circle } from "react-konva";

import MapInteractionContext from "../../contexts/MapInteractionContext";

import { compare as comparePoints } from "../../helpers/vector2";
import {
  getBrushPositionForTool,
  getDefaultShapeData,
  getUpdatedShapeData,
  simplifyPoints,
  getStrokeWidth,
} from "../../helpers/drawing";

import colors from "../../helpers/colors";
import useMapBrush from "../../helpers/useMapBrush";

function MapDrawing({
  shapes,
  onShapeAdd,
  onShapesRemove,
  selectedToolId,
  selectedToolSettings,
  gridSize,
}) {
  const { stageScale, mapWidth, mapHeight } = useContext(MapInteractionContext);
  const [drawingShape, setDrawingShape] = useState(null);
  const [isBrushDown, setIsBrushDown] = useState(false);
  const [erasingShapes, setErasingShapes] = useState([]);

  const shouldHover = selectedToolId === "erase";
  const isEditing =
    selectedToolId === "brush" ||
    selectedToolId === "shape" ||
    selectedToolId === "erase";

  const handleBrushUp = useCallback(() => {
    setIsBrushDown(false);
    if (erasingShapes.length > 0) {
      onShapesRemove(erasingShapes.map((shape) => shape.id));
      setErasingShapes([]);
    }
  }, [erasingShapes, onShapesRemove]);

  const handleShapeDraw = useCallback(
    (brushState, mapBrushPosition) => {
      function startShape() {
        const brushPosition = getBrushPositionForTool(
          mapBrushPosition,
          selectedToolId,
          selectedToolSettings,
          gridSize,
          shapes
        );
        const commonShapeData = {
          color: selectedToolSettings && selectedToolSettings.color,
          blend: selectedToolSettings && selectedToolSettings.useBlending,
          id: shortid.generate(),
        };
        if (selectedToolId === "brush") {
          setDrawingShape({
            type: "path",
            pathType: selectedToolSettings.type,
            data: { points: [brushPosition] },
            strokeWidth: selectedToolSettings.type === "stroke" ? 1 : 0,
            ...commonShapeData,
          });
        } else if (selectedToolId === "shape") {
          setDrawingShape({
            type: "shape",
            shapeType: selectedToolSettings.type,
            data: getDefaultShapeData(selectedToolSettings.type, brushPosition),
            strokeWidth: 0,
            ...commonShapeData,
          });
        }
        setIsBrushDown(true);
      }

      function continueShape() {
        const brushPosition = getBrushPositionForTool(
          mapBrushPosition,
          selectedToolId,
          selectedToolSettings,
          gridSize,
          shapes
        );
        if (selectedToolId === "brush") {
          setDrawingShape((prevShape) => {
            const prevPoints = prevShape.data.points;
            if (
              comparePoints(
                prevPoints[prevPoints.length - 1],
                brushPosition,
                0.001
              )
            ) {
              return prevShape;
            }
            const simplified = simplifyPoints(
              [...prevPoints, brushPosition],
              gridSize,
              stageScale
            );
            return {
              ...prevShape,
              data: { points: simplified },
            };
          });
        } else if (selectedToolId === "shape") {
          setDrawingShape((prevShape) => ({
            ...prevShape,
            data: getUpdatedShapeData(
              prevShape.shapeType,
              prevShape.data,
              brushPosition,
              gridSize
            ),
          }));
        }
      }

      function endShape() {
        if (selectedToolId === "brush" && drawingShape) {
          if (drawingShape.data.points.length > 1) {
            onShapeAdd(drawingShape);
          }
        } else if (selectedToolId === "shape" && drawingShape) {
          onShapeAdd(drawingShape);
        }
        setDrawingShape(null);
        handleBrushUp();
      }

      switch (brushState) {
        case "first":
          startShape();
          return;
        case "drawing":
          continueShape();
          return;
        case "last":
          endShape();
          return;
        default:
          return;
      }
    },
    [
      selectedToolId,
      selectedToolSettings,
      gridSize,
      stageScale,
      onShapeAdd,
      shapes,
      drawingShape,
      handleBrushUp,
    ]
  );

  useMapBrush(isEditing, handleShapeDraw);

  function handleShapeOver(shape, isDown) {
    if (shouldHover && isDown) {
      if (erasingShapes.findIndex((s) => s.id === shape.id) === -1) {
        setErasingShapes((prevShapes) => [...prevShapes, shape]);
      }
    }
  }

  function renderShape(shape) {
    const defaultProps = {
      key: shape.id,
      onMouseMove: () => handleShapeOver(shape, isBrushDown),
      onTouchOver: () => handleShapeOver(shape, isBrushDown),
      onMouseDown: () => handleShapeOver(shape, true),
      onTouchStart: () => handleShapeOver(shape, true),
      fill: colors[shape.color] || shape.color,
      opacity: shape.blend ? 0.5 : 1,
    };
    if (shape.type === "path") {
      return (
        <Line
          points={shape.data.points.reduce(
            (acc, point) => [...acc, point.x * mapWidth, point.y * mapHeight],
            []
          )}
          stroke={colors[shape.color] || shape.color}
          tension={0.5}
          closed={shape.pathType === "fill"}
          fillEnabled={shape.pathType === "fill"}
          lineCap="round"
          strokeWidth={getStrokeWidth(
            shape.strokeWidth,
            gridSize,
            mapWidth,
            mapHeight
          )}
          {...defaultProps}
        />
      );
    } else if (shape.type === "shape") {
      if (shape.shapeType === "rectangle") {
        return (
          <Rect
            x={shape.data.x * mapWidth}
            y={shape.data.y * mapHeight}
            width={shape.data.width * mapWidth}
            height={shape.data.height * mapHeight}
            {...defaultProps}
          />
        );
      } else if (shape.shapeType === "circle") {
        const minSide = mapWidth < mapHeight ? mapWidth : mapHeight;
        return (
          <Circle
            x={shape.data.x * mapWidth}
            y={shape.data.y * mapHeight}
            radius={shape.data.radius * minSide}
            {...defaultProps}
          />
        );
      } else if (shape.shapeType === "triangle") {
        return (
          <Line
            points={shape.data.points.reduce(
              (acc, point) => [...acc, point.x * mapWidth, point.y * mapHeight],
              []
            )}
            closed={true}
            {...defaultProps}
          />
        );
      }
    }
  }

  function renderErasingShape(shape) {
    const eraseShape = {
      ...shape,
      color: "#BB99FF",
    };
    return renderShape(eraseShape);
  }

  return (
    <Group>
      {shapes.map(renderShape)}
      {drawingShape && renderShape(drawingShape)}
      {erasingShapes.length > 0 && erasingShapes.map(renderErasingShape)}
    </Group>
  );
}

export default MapDrawing;