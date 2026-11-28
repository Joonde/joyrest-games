import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSerialLine, serialCommand } from "./usb-serial.mjs";

test("протокол USB: нажатие, heartbeat, забытая кнопка, мусор", () => {
  assert.deepEqual(parseSerialLine("BUTTON_PRESS:3\r"), { kind: "press", buttonId: "3" });
  assert.deepEqual(parseSerialLine("HEARTBEAT:3"), { kind: "heartbeat", buttonId: "3" });
  assert.deepEqual(parseSerialLine("No paired button found with id:3"), { kind: "forgotten", buttonId: "3" });
  assert.equal(parseSerialLine("unknown"), null);
  assert.equal(parseSerialLine(""), null);
  assert.equal(parseSerialLine("BUTTON_PRESS:"), null);
});

test("команды включения и подсветки совпадают с протоколом приёмника", () => {
  assert.equal(serialCommand(4, "ENABLE"), "BUTTON:4:ENABLE\n");
  assert.equal(serialCommand(4, "UNBLOCK"), "BUTTON:4:UNBLOCK\n");
  assert.equal(serialCommand(4, "LED_ON"), "BUTTON:4:LED_ON\n");
  assert.equal(serialCommand(4, "LED_OFF"), "BUTTON:4:LED_OFF\n");
});
