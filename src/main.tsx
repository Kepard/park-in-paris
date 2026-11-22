import React from "react";
import ReactDOM from "react-dom/client";
import { domMax, LazyMotion, MotionConfig } from "motion/react";
import App from "./App";
import { reducedMotion, useMediaQuery } from "./lib/useViewport";
import "./styles.css";

function PlannerApp() {
  const reduce = useMediaQuery(reducedMotion);
  return <MotionConfig reducedMotion="user" skipAnimations={reduce}
    transition={{ type: "spring", stiffness: 440, damping: 38, mass: 0.85 }}>
    <LazyMotion features={domMax} strict><App /></LazyMotion>
  </MotionConfig>;
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PlannerApp />
  </React.StrictMode>,
);
