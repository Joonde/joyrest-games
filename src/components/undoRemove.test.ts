import { describe, expect, it } from "vitest";
import { insertBack, removeAt } from "./undoRemove";

describe("убрать и вернуть на место", () => {
  it("возвращает элемент на прежний номер", () => {
    const { list, removed } = removeAt(["a", "b", "c", "d"], 1);
    expect(list).toEqual(["a", "c", "d"]);
    expect(removed).toEqual({ item: "b", index: 1 });
    expect(insertBack(list, removed!)).toEqual(["a", "b", "c", "d"]);
  });

  it("первый и последний элемент", () => {
    const first = removeAt([1, 2, 3], 0);
    expect(insertBack(first.list, first.removed!)).toEqual([1, 2, 3]);
    const last = removeAt([1, 2, 3], 2);
    expect(insertBack(last.list, last.removed!)).toEqual([1, 2, 3]);
  });

  it("список укоротился — номер обрезается до конца", () => {
    const { removed } = removeAt(["a", "b", "c", "d"], 3);
    expect(insertBack(["a"], removed!)).toEqual(["a", "d"]);
  });

  it("номер вне списка — ничего не убрано", () => {
    expect(removeAt(["a"], 5)).toEqual({ list: ["a"], removed: null });
    expect(removeAt(["a"], -1).removed).toBeNull();
  });

  it("повторный возврат с ключом не дублирует", () => {
    const items = [{ id: "x" }, { id: "y" }];
    const { list, removed } = removeAt(items, 0);
    const back = insertBack(list, removed!, (i) => i.id);
    expect(insertBack(back, removed!, (i) => i.id)).toEqual(items);
  });

  it("исходный список не меняется", () => {
    const src = ["a", "b"];
    const { list, removed } = removeAt(src, 0);
    insertBack(list, removed!);
    expect(src).toEqual(["a", "b"]);
  });
});
