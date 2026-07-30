"use client";

import { createContext, useContext } from "react";

export const CanvasContext = createContext({
  displayMode: "single" as "single" | "grid",
  scale: 1,
  moveScreen: (_id: string, _x: number, _y: number): void => undefined,
});

export const useCanvasControls = () => useContext(CanvasContext);
