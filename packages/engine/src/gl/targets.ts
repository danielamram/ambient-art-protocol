/**
 * Offscreen render targets for the post stack. DOM/WebGL only; nothing here is unit-tested.
 */

export interface ColorFormat {
  readonly internalFormat: number;
  readonly format: number;
  readonly type: number;
  /** True for half-float targets that keep values above 1.0. */
  readonly hdr: boolean;
}

/**
 * Prefer RGBA16F so feedback decays to true black and bloom has headroom. Half-float textures are
 * filterable in WebGL2 core, but rendering to them needs EXT_color_buffer_float (or the older
 * half-float extension), so probe a tiny FBO and fall back to RGBA8 on anything incomplete.
 */
export function pickColorFormat(gl: WebGL2RenderingContext): ColorFormat {
  const ldr: ColorFormat = {
    internalFormat: gl.RGBA8,
    format: gl.RGBA,
    type: gl.UNSIGNED_BYTE,
    hdr: false,
  };
  const ext =
    gl.getExtension('EXT_color_buffer_float') ?? gl.getExtension('EXT_color_buffer_half_float');
  if (!ext) return ldr;
  const hdr: ColorFormat = {
    internalFormat: gl.RGBA16F,
    format: gl.RGBA,
    type: gl.HALF_FLOAT,
    hdr: true,
  };
  const probe = new RenderTarget(gl, 4, 4, hdr);
  const ok = probe.complete;
  probe.dispose();
  return ok ? hdr : ldr;
}

export class RenderTarget {
  readonly gl: WebGL2RenderingContext;
  readonly texture: WebGLTexture;
  readonly fbo: WebGLFramebuffer;
  readonly width: number;
  readonly height: number;
  readonly complete: boolean;

  constructor(gl: WebGL2RenderingContext, width: number, height: number, fmt: ColorFormat) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    const texture = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!texture || !fbo) throw new Error('Could not allocate a render target');
    this.texture = texture;
    this.fbo = fbo;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // `null` data is zero-filled by the spec, so feedback themes start from black.
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      fmt.internalFormat,
      width,
      height,
      0,
      fmt.format,
      fmt.type,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    this.complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  clear(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(): void {
    this.gl.deleteFramebuffer(this.fbo);
    this.gl.deleteTexture(this.texture);
  }
}
