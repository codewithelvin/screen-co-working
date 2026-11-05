// electron-builder afterPack: remove files the app never loads.
// dxcompiler/dxil are Chromium's DirectX shader compiler for WebGPU only. Screen capture, video
// decode and WebGL use ANGLE (d3dcompiler_47) and SwiftShader, which stay.
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const UNUSED = { win32: ['dxcompiler.dll', 'dxil.dll'] };

export default async function afterPack(ctx) {
  for (const f of UNUSED[ctx.electronPlatformName] ?? []) rmSync(join(ctx.appOutDir, f), { force: true });
}
