import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider, theme } from "antd";
import AirLockApp from "./AirLockApp";
import "../styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#38bdf8",
          colorInfo: "#38bdf8",
          colorSuccess: "#2dd4bf",
          colorWarning: "#fbbf24",
          colorError: "#fb7185",
          colorBgBase: "#050b18",
          colorBgContainer: "#0d1729",
          colorBorder: "rgba(148, 163, 184, 0.14)",
          colorText: "#f1f5f9",
          colorTextSecondary: "#94a3b8",
          borderRadius: 14,
          borderRadiusLG: 20,
          fontFamily:
            "Inter, 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
          controlHeight: 40,
        },
        components: {
          Card: { bodyPadding: 22 },
          Menu: {
            darkItemBg: "transparent",
            darkItemSelectedBg: "rgba(56, 189, 248, 0.14)",
            darkItemSelectedColor: "#7dd3fc",
            itemBorderRadius: 12,
          },
          Table: {
            headerBg: "rgba(15, 28, 48, 0.9)",
            rowHoverBg: "rgba(56, 189, 248, 0.06)",
          },
        },
      }}
    >
      <AntApp>
        <AirLockApp />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
