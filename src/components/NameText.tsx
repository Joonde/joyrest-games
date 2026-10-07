import { splitEmoji } from "../core/emoji";

/**
 * Имя со смайликом. Смайлик — отдельным элементом со своим цветом: в надписях с градиентом
 * (`background-clip: text`, прозрачный цвет) он иначе пропадает или становится силуэтом.
 */
export function NameText({ name }: { name: string }) {
  const { emoji, name: text } = splitEmoji(name);
  if (!emoji) return <>{name}</>;
  return (
    <>
      <span className="name-emoji">{emoji}</span> {text}
    </>
  );
}
