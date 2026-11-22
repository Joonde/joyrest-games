import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

/** Протокол USB-приёмника, совместимый с Quizzly: 9600 baud, строки с \n. */
export function parseSerialLine(line) {
  const value = line.trim();
  if (!value) return null;
  if (value.startsWith("HEARTBEAT:")) {
    const buttonId = value.slice(10).trim();
    return buttonId ? { kind: "heartbeat", buttonId } : null;
  }
  if (value.startsWith("BUTTON_PRESS:")) {
    const buttonId = value.slice(13).trim();
    return buttonId ? { kind: "press", buttonId } : null;
  }
  if (value.startsWith("No paired button found with id:")) {
    const buttonId = value.slice(31).trim();
    return buttonId ? { kind: "forgotten", buttonId } : null;
  }
  return null;
}

export function serialCommand(buttonId, action) {
  return `BUTTON:${buttonId}:${action}\n`;
}

function cleanId(value) {
  return /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : null;
}

export async function startUsbSerialAdapter({ portPath, baudRate = 9600, adapterUrl, adapterKey, onError = () => undefined }) {
  if (!portPath) throw new Error("Укажите JOYREST_SERIAL_PORT");
  const port = new SerialPort({ path: portPath, baudRate, autoOpen: false });
  const counters = new Map();
  await new Promise((resolve, reject) => port.open((error) => (error ? reject(error) : resolve())));

  async function send(type, buttonId, sequence = "") {
    const response = await fetch(`${adapterUrl}/api/adapters/usb/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-JoyRest-Adapter-Key": adapterKey },
      body: JSON.stringify({ type, hardwareId: `usb-${buttonId}`, alias: `USB ${buttonId}`, sequence }),
    });
    if (!response.ok) onError(new Error(`USB adapter HTTP ${response.status}`));
  }

  const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));
  parser.on("data", (line) => {
    const event = parseSerialLine(line);
    if (!event) return;
    const buttonId = cleanId(event.buttonId);
    if (!buttonId) return;
    if (event.kind === "press") {
      // Время запуска события + счётчик: после перезапуска программы новое нажатие не совпадёт со старым eventId.
      const sequence = `${Date.now()}-${counters.get(buttonId) ?? 0}`;
      counters.set(buttonId, (counters.get(buttonId) ?? 0) + 1);
      void send("down", buttonId, sequence).catch(onError);
    } else if (event.kind === "heartbeat") {
      void send("connected", buttonId).catch(onError);
    }
  });
  port.on("error", onError);

  return {
    async prepare(buttonId) {
      for (const action of ["ENABLE", "UNBLOCK", "LED_ON"]) await write(serialCommand(buttonId, action));
    },
    async setLed(buttonId, on) {
      await write(serialCommand(buttonId, on ? "LED_ON" : "LED_OFF"));
    },
    async enableAll() {
      await write("BROADCAST:ENABLE\n");
    },
    async close() {
      parser.removeAllListeners();
      if (port.isOpen) await new Promise((resolve) => port.close(resolve));
    },
  };

  async function write(text) {
    await new Promise((resolve, reject) => port.write(text, (error) => (error ? reject(error) : resolve())));
    await new Promise((resolve, reject) => port.drain((error) => (error ? reject(error) : resolve())));
  }
}
