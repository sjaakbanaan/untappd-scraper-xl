const esc = (code) => `\u001b[${code}m`;

const RESET  = esc(0);
const CYAN   = esc(36);
const YELLOW = esc(33);
const GREEN  = esc(32);
const RED    = esc(31);
const GRAY   = esc(90);
const BLUE   = esc(34);

export const cPage    = (txt) => CYAN + txt + RESET;
export const cBatch   = (txt) => BLUE + txt + RESET;
export const cPhase   = (txt) => YELLOW + txt + RESET;
export const cSuccess = (txt) => GREEN + txt + RESET;
export const cError   = (txt) => RED + txt + RESET;
export const cDim     = (txt) => GRAY + txt + RESET;
export const cTotal   = (txt) => YELLOW + txt + RESET;
export const cArrow   = (txt) => CYAN + txt + RESET;
