import { app, BrowserWindow } from "electron";
import http from "node:http";
import path from "node:path";
import { registerIpcHandlers, shutdownMobileDevices } from "./ipc";

const DEVELOPMENT_PORT = 3000;
const PACKAGED_PORT = 3010;
const isDevelopment = !app.isPackaged;
const developmentUrl = process.env.ELECTRON_START_URL ?? `http://127.0.0.1:${DEVELOPMENT_PORT}`;

let mainWindow: BrowserWindow | null = null;

function getProductionUrl(): string {
  return `http://127.0.0.1:${PACKAGED_PORT}`;
}

function startPackagedNextServer(): void {
  const serverDirectory = path.join(process.resourcesPath, "next");
  const serverEntry = path.join(serverDirectory, "server.js");
  const environment = process.env as Record<string, string | undefined>;

  environment["NODE_ENV"] = "production";
  environment["PORT"] = String(PACKAGED_PORT);
  environment["HOSTNAME"] = "127.0.0.1";
  process.chdir(serverDirectory);

  // Next.js standalone's generated server starts when this module is loaded.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(serverEntry);
}

function waitForNextServer(url: string, attempts = 40): Promise<void> {
  return new Promise((resolve, reject) => {
    const tryConnection = (remaining: number) => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on("error", () => {
        if (remaining <= 1) {
          reject(new Error(`Next.js did not start at ${url}.`));
          return;
        }

        setTimeout(() => tryConnection(remaining - 1), 250);
      });

      request.setTimeout(1000, () => request.destroy());
    };

    tryConnection(attempts);
  });
}

function isAllowedNavigation(url: string, applicationUrl: string): boolean {
  try {
    const destination = new URL(url);
    const application = new URL(applicationUrl);
    return destination.origin === application.origin;
  } catch {
    return false;
  }
}

async function createMainWindow(): Promise<void> {
  const applicationUrl = isDevelopment ? developmentUrl : getProductionUrl();

  if (!isDevelopment) {
    startPackagedNextServer();
    await waitForNextServer(applicationUrl);
  }

  mainWindow = new BrowserWindow({
    show: false,
    width: 1920,
    height: 1080,
    minWidth: 1024,
    minHeight: 768,
    fullscreen: !isDevelopment,
    kiosk: !isDevelopment,
    autoHideMenuBar: true,
    backgroundColor: "#0A0E15",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.maximize();
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigation(url, applicationUrl)) {
      event.preventDefault();
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  registerIpcHandlers(mainWindow);
  await mainWindow.loadURL(applicationUrl);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

app.whenReady().then(async () => {
  try {
    await createMainWindow();
  } catch (error) {
      console.error("Unable to start JLCG Operations Command Center.", error);
      app.quit();
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    void shutdownMobileDevices();
    app.quit();
  });
}
