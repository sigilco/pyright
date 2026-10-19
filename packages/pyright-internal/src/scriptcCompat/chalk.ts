/*
 * scriptc-compat shim for `chalk`.
 *
 * The pyright CLI uses chalk only to colorize console output. Under the
 * scriptc-native build there is no ANSI pipeline (chalk's dependency tree —
 * ansi-styles, supports-color, color-convert — is CJS and mutates object
 * shapes at runtime in ways scriptc refuses), so this shim implements the
 * chalk API as a pass-through: every style is the identity function.
 * Colors are intentionally absent in the native build.
 */

interface ChalkStyle {
    (text: string): string;
    bold: ChalkStyle;
    italic: ChalkStyle;
    underline: ChalkStyle;
    inverse: ChalkStyle;
    strikethrough: ChalkStyle;
    visible: ChalkStyle;
    black: ChalkStyle;
    red: ChalkStyle;
    green: ChalkStyle;
    yellow: ChalkStyle;
    blue: ChalkStyle;
    magenta: ChalkStyle;
    cyan: ChalkStyle;
    white: ChalkStyle;
    gray: ChalkStyle;
    grey: ChalkStyle;
    blackBright: ChalkStyle;
    redBright: ChalkStyle;
    greenBright: ChalkStyle;
    yellowBright: ChalkStyle;
    blueBright: ChalkStyle;
    magentaBright: ChalkStyle;
    cyanBright: ChalkStyle;
    whiteBright: ChalkStyle;
    bgBlack: ChalkStyle;
    bgRed: ChalkStyle;
    bgGreen: ChalkStyle;
    bgYellow: ChalkStyle;
    bgBlue: ChalkStyle;
    bgMagenta: ChalkStyle;
    bgCyan: ChalkStyle;
    bgWhite: ChalkStyle;
    keyword(colorName: string): ChalkStyle;
    rgb(red: number, green: number, blue: number): ChalkStyle;
    hex(colorHex: string): ChalkStyle;
    ansi256(index: number): ChalkStyle;
    bgKeyword(colorName: string): ChalkStyle;
    bgRgb(red: number, green: number, blue: number): ChalkStyle;
    bgHex(colorHex: string): ChalkStyle;
    bgAnsi256(index: number): ChalkStyle;
}

interface ChalkInstance extends ChalkStyle {
    level: 0 | 1 | 2 | 3;
    Instance: new (options?: { level?: 0 | 1 | 2 | 3 }) => ChalkInstance;
    stderr: ChalkInstance;
    supportsColor: false;
}

const passthrough = ((text: string) => text) as ChalkStyle;
const styleNames = [
    'bold',
    'italic',
    'underline',
    'inverse',
    'strikethrough',
    'visible',
    'black',
    'red',
    'green',
    'yellow',
    'blue',
    'magenta',
    'cyan',
    'white',
    'gray',
    'grey',
    'blackBright',
    'redBright',
    'greenBright',
    'yellowBright',
    'blueBright',
    'magentaBright',
    'cyanBright',
    'whiteBright',
    'bgBlack',
    'bgRed',
    'bgGreen',
    'bgYellow',
    'bgBlue',
    'bgMagenta',
    'bgCyan',
    'bgWhite',
] as const;
for (const name of styleNames) {
    passthrough[name] = passthrough;
}
passthrough.keyword = () => passthrough;
passthrough.rgb = () => passthrough;
passthrough.hex = () => passthrough;
passthrough.ansi256 = () => passthrough;
passthrough.bgKeyword = () => passthrough;
passthrough.bgRgb = () => passthrough;
passthrough.bgHex = () => passthrough;
passthrough.bgAnsi256 = () => passthrough;

const chalk = passthrough as ChalkInstance;
chalk.level = 0;
chalk.Instance = class {
    constructor() {
        return chalk;
    }
} as unknown as ChalkInstance['Instance'];
chalk.stderr = chalk;
chalk.supportsColor = false;

export default chalk;
