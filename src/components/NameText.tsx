/** Смайлик со всеми модификаторами: тон кожи, вариант, склейки (👨‍👩‍👧), флаги. */
const EMOJI =
  /(\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:️|⃣|[\u{1F3FB}-\u{1F3FF}])*(?:‍\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])*)*)/u;

/** Части имени: текст и смайлики по отдельности. */
export function nameParts(name: string): Array<{ text: string; emoji: boolean }> {
  return name
    .split(new RegExp(EMOJI.source, "gu"))
    .filter((part) => part !== "")
    .map((part) => ({ text: part, emoji: EMOJI.test(part) && new RegExp(`^${EMOJI.source}$`, "u").test(part) }));
}

/**
 * Имя со смайликами. Каждый смайлик — отдельным элементом со своим цветом: в надписях с
 * градиентом (`background-clip: text`, прозрачный цвет) он иначе пропадает или становится белым
 * кругом. Смайлики могут быть где угодно в имени — ведущий дописывает их при переименовании.
 */
export function NameText({ name }: { name: string }) {
  const parts = nameParts(name);
  if (!parts.some((p) => p.emoji)) return <>{name}</>;
  return (
    <>
      {parts.map((part, i) =>
        part.emoji ? (
          <span key={i} className="name-emoji">
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}
