'use strict';
// Thin WebGL wrapper. Shaders are written once (GLSL ES 3.00 subset) and down-converted
// for WebGL1 devices, which keeps the game running on older Android WebViews.
(function (ZM) {
  class GL {
    constructor(canvas) {
      const opts = { antialias: true, alpha: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
      let gl = canvas.getContext('webgl2', opts);
      this.isGL2 = !!gl;
      if (!gl) {
        gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
        if (!gl) throw new Error('WebGL not available');
        this.inst = gl.getExtension('ANGLE_instanced_arrays');
        if (!this.inst) throw new Error('Instancing not available');
        if (gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 1) throw new Error('Vertex textures not available');
      }
      this.gl = gl;
      this.canvas = canvas;
    }

    convert(src, isVertex) {
      if (this.isGL2) return '#version 300 es\n' + src;
      let s = src;
      if (isVertex) {
        s = s.replace(/^\s*in\s/gm, 'attribute ').replace(/^\s*out\s/gm, 'varying ');
      } else {
        s = s.replace(/^\s*in\s/gm, 'varying ').replace(/^\s*out\s+vec4\s+fragColor\s*;/m, '');
        s = s.replace(/\bfragColor\b/g, 'gl_FragColor');
      }
      s = s.replace(/\btexture\s*\(/g, 'texture2D(');
      return s;
    }

    shader(type, src) {
      const gl = this.gl;
      const sh = gl.createShader(type);
      gl.shaderSource(sh, this.convert(src, type === gl.VERTEX_SHADER));
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        console.error(log, '\n', src.split('\n').map((l, i) => i + 1 + ': ' + l).join('\n'));
        throw new Error('Shader compile failed: ' + log);
      }
      return sh;
    }

    program(vs, fs, attribs) {
      const gl = this.gl;
      const p = gl.createProgram();
      gl.attachShader(p, this.shader(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, this.shader(gl.FRAGMENT_SHADER, fs));
      attribs.forEach((name, i) => gl.bindAttribLocation(p, i, name));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link failed: ' + gl.getProgramInfoLog(p));
      const uniforms = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(p, i);
        const name = info.name.replace(/\[0\]$/, '');
        uniforms[name] = gl.getUniformLocation(p, info.name);
      }
      return { p, u: uniforms, attribs };
    }

    buffer(data, usage) {
      const gl = this.gl;
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
      return b;
    }

    texture(w, h, data, linear, wrap) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      const f = linear ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap || gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap || gl.CLAMP_TO_EDGE);
      t.w = w; t.h = h;
      return t;
    }

    update(tex, data) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tex.w, tex.h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }

    canvasTexture(canvas, mipmap) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      const pot = (canvas.width & (canvas.width - 1)) === 0 && (canvas.height & (canvas.height - 1)) === 0;
      if (mipmap && (this.isGL2 || pot)) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }

    // attribute setup: list of {buf, loc, size, stride, offset, divisor}
    attrib(loc, buf, size, stride, offset, divisor) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
      if (this.isGL2) gl.vertexAttribDivisor(loc, divisor || 0);
      else this.inst.vertexAttribDivisorANGLE(loc, divisor || 0);
    }

    disableAttribs(from, to) {
      const gl = this.gl;
      for (let i = from; i < to; i++) {
        gl.disableVertexAttribArray(i);
        if (this.isGL2) gl.vertexAttribDivisor(i, 0);
        else this.inst.vertexAttribDivisorANGLE(i, 0);
      }
    }

    drawInstanced(mode, first, count, instances) {
      if (instances <= 0) return;
      if (this.isGL2) this.gl.drawArraysInstanced(mode, first, count, instances);
      else this.inst.drawArraysInstancedANGLE(mode, first, count, instances);
    }
  }
  ZM.GL = GL;
})(window.ZM);
