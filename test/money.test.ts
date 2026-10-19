import { describe, expect, test } from "bun:test";
import { centsToInput, eur, investedFromPerformance, parseCents, parsePercent, signedPct } from "../src/money.ts";
import { addMonths, monthRange, parseMonthLabel } from "../src/months.ts";

describe("parseCents", () => {
  test.each([
    ["14 180,00 €", 1418000],
    ["14 180,00 €", 1418000],
    ["-55,99 €", -5599],
    ["−55,99", -5599],
    ["1234.5", 123450],
    ["168", 16800],
    ["0,07", 7],
    ["-0", 0],
  ])("%p → %p", (input, cents) => expect(parseCents(input)).toBe(cents));

  test("vide → null", () => expect(parseCents("  ")).toBeNull());
  test.each(["abc", "1,234.56", "12,345", "1 2,3,4"])("refuse %p", (input) => expect(() => parseCents(input)).toThrow());
});

test("parsePercent", () => {
  expect(parsePercent("+15,23 %")).toBe(15.23);
  expect(parsePercent("-3")).toBe(-3);
  expect(parsePercent("")).toBeNull();
});

test("centsToInput", () => {
  expect(centsToInput(1718000)).toBe("17180,00");
  expect(centsToInput(-5)).toBe("-0,05");
});

test("capital investi déduit de la performance (exemple du README)", () => {
  expect(investedFromPerformance(719268, 15)).toBe(625450);
  expect(() => investedFromPerformance(1000, -100)).toThrow();
});

test("formats français", () => {
  expect(eur(5033007).replace(/\s/g, " ")).toBe("50 330,07 €");
  expect(signedPct(-0.0013).replace(/\s/g, " ")).toBe("-0,13 %");
});

describe("mois", () => {
  test("addMonths / monthRange", () => {
    expect(addMonths("2025-12", 1)).toBe("2026-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  test.each([
    ["décembre 2025", "2025-12"],
    ["Aout 2026", "2026-08"],
    ["févr. 2026", "2026-02"],
    ["12/2025", "2025-12"],
    ["2026-03", "2026-03"],
    ["jui 2026", null],
    ["Total", null],
  ])("parseMonthLabel(%p)", (input, month) => expect(parseMonthLabel(input)).toBe(month));
});
