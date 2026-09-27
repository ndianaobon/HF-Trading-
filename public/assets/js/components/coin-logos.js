// Simplified inline SVG marks for the coins and networks used in the deposit
// flow. Anything unknown falls back to the generic lettered asset badge.

import { raw } from "../core/dom.js";
import { assetIcon } from "../core/ui.js";

const MARKS = {
  USDT: `<circle cx="16" cy="16" r="16" fill="#26A17B"/><path fill="#fff" d="M17.8 17.3v-.01c-.1 0-.64.04-1.8.04-.93 0-1.58-.03-1.81-.04-3.56-.16-6.22-.78-6.22-1.52s2.66-1.36 6.22-1.52v2.42c.23.02.9.06 1.82.06 1.1 0 1.66-.05 1.79-.06v-2.42c3.55.16 6.2.78 6.2 1.52s-2.65 1.36-6.2 1.52m0-3.29v-2.17h4.96V8.53H9.25v3.31h4.96v2.17c-4.03.18-7.06.98-7.06 1.94s3.03 1.75 7.06 1.94v6.94h3.59v-6.94c4.02-.19 7.04-.98 7.04-1.94s-3.02-1.75-7.04-1.94"/>`,
  BTC: `<circle cx="16" cy="16" r="16" fill="#F7931A"/><path fill="#fff" d="M22.6 14.1c.3-2.1-1.3-3.2-3.4-3.9l.7-2.8-1.7-.4-.7 2.7-1.4-.3.7-2.7-1.7-.4-.7 2.8-1.1-.3-2.4-.6-.4 1.8s1.3.3 1.2.3c.7.2.8.6.8 1l-.8 3.2.2.1-.2-.1-1.1 4.5c-.1.2-.3.5-.8.4 0 0-1.2-.3-1.2-.3l-.8 1.9 2.2.6 1.2.3-.7 2.8 1.7.4.7-2.8 1.4.4-.7 2.8 1.7.4.7-2.8c2.9.5 5.1.3 6-2.3.7-2.1 0-3.3-1.5-4.1 1.1-.3 2-1 2.2-2.5zm-3.9 5.4c-.5 2.1-4 1-5.2.7l.9-3.7c1.2.3 4.8.9 4.3 3zm.5-5.5c-.5 1.9-3.4.9-4.3.7l.8-3.3c1 .2 4 .7 3.5 2.6z"/>`,
  ETH: `<circle cx="16" cy="16" r="16" fill="#627EEA"/><g fill="#fff"><path fill-opacity=".6" d="M16.5 4v8.87l7.5 3.35z"/><path d="M16.5 4 9 16.22l7.5-3.35z"/><path fill-opacity=".6" d="M16.5 21.97V28L24 17.62z"/><path d="M16.5 28v-6.03L9 17.62z"/><path fill-opacity=".2" d="m16.5 20.57 7.5-4.35-7.5-3.35z"/><path fill-opacity=".6" d="m9 16.22 7.5 4.35v-7.7z"/></g>`,
  BNB: `<circle cx="16" cy="16" r="16" fill="#F3BA2F"/><path fill="#fff" d="M12.12 14.44 16 10.56l3.88 3.88 2.26-2.26L16 6.04l-6.14 6.14zM6.04 16l2.26-2.26L10.56 16 8.3 18.26zm6.08 1.56L16 21.44l3.88-3.88 2.26 2.26L16 25.96l-6.14-6.14zM21.44 16l2.26-2.26L25.96 16l-2.26 2.26zM18.29 16 16 13.71 14.31 15.4l-.19.2-.4.4L16 18.29z"/>`,
  SOL: `<defs><linearGradient id="sol-g" x1="8" x2="24" y1="24" y2="8" gradientUnits="userSpaceOnUse"><stop stop-color="#9945FF"/><stop offset=".5" stop-color="#5497D5"/><stop offset="1" stop-color="#19FB9B"/></linearGradient></defs><circle cx="16" cy="16" r="16" fill="#0B0B12"/><path fill="url(#sol-g)" d="M10.4 19.9a.5.5 0 0 1 .36-.15h12.1c.23 0 .34.27.18.43l-2.4 2.4a.5.5 0 0 1-.36.15H8.18a.25.25 0 0 1-.18-.43zm0-9.05A.52.52 0 0 1 10.76 10.7h12.1c.23 0 .34.27.18.43l-2.4 2.4a.5.5 0 0 1-.36.15H8.18a.25.25 0 0 1-.18-.43zm10.28 4.5a.5.5 0 0 0-.36-.15H8.2a.25.25 0 0 0-.18.43l2.4 2.4a.5.5 0 0 0 .36.15h12.1a.25.25 0 0 0 .18-.43z"/>`,
  TRX: `<circle cx="16" cy="16" r="16" fill="#EB0029"/><path fill="none" stroke="#fff" stroke-linejoin="round" stroke-width="1.6" d="m8 8.5 17 3.2-9.6 12.3zm0 0 7.4 15.5m-.2-6.9 9.8-5.4M8 8.5l7.2 8.6 3.8-7"/>`,
  POL: `<circle cx="16" cy="16" r="16" fill="#8247E5"/><path fill="#fff" d="M20.1 12.6a1.4 1.4 0 0 0-1.33 0l-3.07 1.8-2.08 1.15-3.02 1.79a1.4 1.4 0 0 1-1.33 0l-2.36-1.42a1.37 1.37 0 0 1-.67-1.15v-2.72c0-.46.24-.92.67-1.15l2.36-1.37a1.4 1.4 0 0 1 1.33 0l2.36 1.37c.39.23.67.69.67 1.15v1.8l2.08-1.2v-1.8c0-.46-.24-.92-.67-1.15l-4.39-2.57a1.4 1.4 0 0 0-1.33 0L6.08 9.73a1.24 1.24 0 0 0-.67 1.15v5.18c0 .46.24.92.67 1.15l4.44 2.57c.39.23.9.23 1.33 0l3.02-1.74 2.08-1.2 3.02-1.74a1.4 1.4 0 0 1 1.33 0l2.36 1.37c.39.23.67.69.67 1.15v2.72c0 .46-.24.92-.67 1.15l-2.31 1.37a1.4 1.4 0 0 1-1.33 0l-2.36-1.37a1.37 1.37 0 0 1-.67-1.15v-1.75l-2.08 1.2v1.8c0 .46.24.92.67 1.15l4.44 2.57c.39.23.9.23 1.33 0l4.44-2.57c.39-.23.67-.69.67-1.15v-5.2c0-.46-.24-.92-.67-1.15z"/>`,
  APT: `<circle cx="16" cy="16" r="16" fill="#0B0B0B"/><path fill="#fff" d="M21.7 13.1h-2.1a.9.9 0 0 1-.66-.3l-.85-.96a.66.66 0 0 0-1 0l-.73.83a1.3 1.3 0 0 1-.98.43H7.6a8.8 8.8 0 0 0-.34 1.63h7.14a.8.8 0 0 0 .56-.24l.67-.69a.66.66 0 0 1 .48-.2h.03c.18 0 .36.08.49.22l.56.63c.17.18.4.29.66.29h8.52a8.8 8.8 0 0 0-.34-1.63zm-6.9 5.12a.9.9 0 0 0 .66-.3l.85-.96a.66.66 0 0 1 1 0l.73.83c.25.28.6.43.98.43h4.4c.2-.52.35-1.07.43-1.63h-5.3a.8.8 0 0 1-.56-.24l-.67-.69a.66.66 0 0 0-.48-.2h-.03a.66.66 0 0 0-.49.22l-.56.63a.9.9 0 0 1-.66.29H6.6c.08.56.23 1.11.43 1.63zM12.3 10.2a.8.8 0 0 0 .56-.24l.67-.68a.66.66 0 0 1 .48-.2h.02c.19 0 .37.08.5.22l.56.62c.16.19.4.29.66.29h5.9a8.8 8.8 0 0 0-10.3 0zm6.2 10.7h-2.47a.9.9 0 0 1-.66-.3l-.85-.96a.66.66 0 0 0-1 0l-.73.83a1.3 1.3 0 0 1-.98.43h-.1a8.8 8.8 0 0 0 11.1 0z"/>`,
  PLASMA: `<circle cx="16" cy="16" r="16" fill="#0F2A24"/><g fill="none" stroke="#E8F5EF"><circle cx="16" cy="16" r="9" stroke-width="1.4" stroke-dasharray="1.2 1.4"/><circle cx="16" cy="16" r="6" stroke-width="1.8" stroke-dasharray="2 1.6"/><circle cx="16" cy="16" r="3" stroke-width="1.6"/></g>`,
  ARB: `<circle cx="16" cy="16" r="16" fill="#213147"/><path fill="none" stroke="#28A0F0" stroke-linejoin="round" stroke-width="1.8" d="m16 6.5 8.2 4.75v9.5L16 25.5l-8.2-4.75v-9.5z"/><path fill="#fff" d="m13.2 20.8 3.8-10h1.6l-3.8 10zm3.4 0 2.6-6.6.8 2.1-1.8 4.5z"/>`,
};

/** Network codes → the brand mark and short ticker shown in the network list. */
const NETWORKS = {
  BEP20: { mark: "BNB", ticker: "BSC" },
  TRC20: { mark: "TRX", ticker: "TRX" },
  ERC20: { mark: "ETH", ticker: "ETH" },
  SOL: { mark: "SOL", ticker: "SOL" },
  POL: { mark: "POL", ticker: "POL" },
  MATIC: { mark: "POL", ticker: "POL" },
  APT: { mark: "APT", ticker: "APT" },
  PLASMA: { mark: "PLASMA", ticker: "PLASMA" },
  ARB: { mark: "ARB", ticker: "ARB" },
  BTC: { mark: "BTC", ticker: "BTC" },
};

const svg = (mark, size, cls) => raw(`<svg viewBox="0 0 32 32" width="${size}" height="${size}" class="shrink-0 ${cls}" aria-hidden="true">${MARKS[mark]}</svg>`);

export function coinLogo(symbol, color, size = 36, cls = "") {
  return MARKS[symbol] ? svg(symbol, size, cls) : assetIcon(symbol, color, size, cls);
}

export function networkLogo(code, color, size = 36, cls = "") {
  const mark = NETWORKS[code]?.mark ?? code;
  return MARKS[mark] ? svg(mark, size, cls) : assetIcon(code, color, size, cls);
}

export const networkTicker = (code) => NETWORKS[code]?.ticker ?? code;
