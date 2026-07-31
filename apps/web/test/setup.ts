import '@testing-library/jest-dom';
// jsdom não define TextEncoder/TextDecoder, usados pelo streaming do chat
// (readStream). Necessário para testar o caminho de streaming (UX-04 e afins).
import { TextDecoder, TextEncoder } from 'node:util';
Object.assign(globalThis, { TextDecoder: globalThis.TextDecoder ?? TextDecoder, TextEncoder: globalThis.TextEncoder ?? TextEncoder });
