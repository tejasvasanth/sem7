import { Tray, Menu, nativeImage } from "electron";
import { logger } from "../logger";

let tray: Tray | null = null;

// A tiny 16x16 lock glyph rendered from a base64 PNG so we don't ship a binary
// asset. Falls back to an empty image if decoding fails.
const ICON_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWklEQVR4nO3TsQ2AMAxE0Z" +
  "9U7L8DGyAKKmpEgYQEBQ0FBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUF" +
  "BQUFBQUFBQUFBQUFBQUAF7SBQm7lC0AAAAASUVORK5CYII=";

export function createTray(
  onOpen: () => void,
  onLock: () => Promise<void> | void,
  onQuit: () => void
): Tray {
  let image = nativeImage.createFromDataURL(`data:image/png;base64,${ICON_BASE64}`);
  if (image.isEmpty()) {
    image = nativeImage.createEmpty();
  }

  tray = new Tray(image);
  tray.setToolTip("AirLock Desktop Agent");

  const menu = Menu.buildFromTemplate([
    { label: "Open Dashboard", click: () => onOpen() },
    { type: "separator" },
    { label: "Lock Now", click: () => void onLock() },
    { type: "separator" },
    { label: "Quit", click: () => onQuit() },
  ]);

  tray.setContextMenu(menu);
  tray.on("double-click", () => onOpen());

  logger.info("System tray created");
  return tray;
}
