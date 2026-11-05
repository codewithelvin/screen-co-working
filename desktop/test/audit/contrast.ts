import type { Page } from '@playwright/test';

export interface Finding {
  text: string;
  size: number;
  ratio: number;
  fg: string;
  bg: string;
}

/**
 * WCAG contrast of every visible text node against its effective background
 * (alpha blended up the tree). AA: 4.5 for normal text, 3 for large (≥ 18.66px bold / 24px).
 */
export function auditContrast(page: Page): Promise<{ fails: Finding[]; sizes: Record<string, number> }> {
  return page.evaluate(() => {
    type RGBA = [number, number, number, number];
    const parse = (c: string): RGBA => {
      const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
      return [m[0], m[1], m[2], m[3] ?? 1];
    };
    const over = (top: RGBA, under: RGBA): RGBA => {
      const a = top[3];
      return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
    };
    const bgOf = (el: Element | null): RGBA => {
      const stack: RGBA[] = [];
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c[3] > 0) stack.push(c);
        if (c[3] >= 1) break;
      }
      let bg: RGBA = [20, 20, 20, 1];
      for (const c of stack.reverse()) bg = over(c, bg);
      return bg;
    };
    const lum = ([r, g, b]: RGBA) =>
      [r, g, b]
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const hex = (c: RGBA) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    const fails: Finding[] = [];
    const sizes: Record<string, number> = {};
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !n.textContent?.trim()) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 || cs.visibility === 'hidden' || el.closest('[aria-hidden="true"]')) continue;
      if (el.closest('input,textarea') || el.closest('.ant-btn-disabled,[disabled]')) continue;
      const bg = bgOf(el);
      let opacity = 1;
      for (let e: Element | null = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
      const fg = over([...parse(cs.color).slice(0, 3), parse(cs.color)[3] * opacity] as RGBA, bg);
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      const ratio = (a + 0.05) / (b + 0.05);
      const size = parseFloat(cs.fontSize);
      sizes[size] = (sizes[size] ?? 0) + 1;
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5))
        fails.push({ text: n.textContent.trim().slice(0, 40), size, ratio: Math.round(ratio * 100) / 100, fg: hex(fg), bg: hex(bg) });
    }
    return { fails, sizes };
  });
}
