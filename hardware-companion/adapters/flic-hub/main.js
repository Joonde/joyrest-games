/**
 * Модуль Flic Hub Studio: пересылает события кнопок в «JoyRest Кнопки».
 * Перед запуском замените COMPANION_URL на адрес компьютера ведущего и ADAPTER_KEY
 * на ключ, который программа напечатала при JOYREST_HARDWARE_HOST=0.0.0.0.
 */
const COMPANION_URL = "http://192.168.1.100:43127";
const ADAPTER_KEY = "REPLACE_WITH_ADAPTER_KEY";
const counters = Object.create(null);

function addressOf(obj) {
  return obj && (obj.bdaddr || (obj.button && obj.button.bdaddr));
}

function send(type, bdaddr) {
  if (!bdaddr) return;
  if (counters[bdaddr] === undefined) counters[bdaddr] = 0;
  const sequence = String(counters[bdaddr]++);
  http.makeRequest(
    {
      url: `${COMPANION_URL}/api/adapters/flic/events`,
      method: "POST",
      headers: { "Content-Type": "application/json", "X-JoyRest-Adapter-Key": ADAPTER_KEY },
      content: JSON.stringify({ type, bdaddr, sequence }),
    },
    (error) => {
      if (error) console.log("JoyRest: не удалось передать событие кнопки");
    },
  );
}

buttons.on("buttonAdded", (obj) => send("added", addressOf(obj)));
buttons.on("buttonConnected", (obj) => send("connected", addressOf(obj)));
buttons.on("buttonReady", (obj) => send("connected", addressOf(obj)));
buttons.on("buttonDisconnected", (obj) => send("disconnected", addressOf(obj)));
buttons.on("buttonDown", (obj) => {
  // Для Flic Duo учитываем только большую кнопку, как в базовом протоколе Flic 2.
  if ((obj.buttonNumber || 0) === 0) send("down", addressOf(obj));
});
