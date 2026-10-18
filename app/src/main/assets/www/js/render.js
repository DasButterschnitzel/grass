'use strict';
// Renderer: background → terrain → grass blades → sprites/particles → floating text.
(function (ZM) {
  const SH = () => ZM.SHADERS;
  const MAX_SPRITES = 6000;
  const FLOATS = 16;

  class SpriteBatch {
    constructor(glw, max) {
      this.glw = glw;
      this.max = max;
      this.data = new Float32Array(max * FLOATS);
      this.n = 0;
      this.buf = glw.buffer(this.data.byteLength, glw.gl.DYNAMIC_DRAW);
    }
    reset() { this.n = 0; }
    push(x, y, sx, sy, rot, uv, r, g, b, a) {
      if (this.n >= this.max) return;
      const d = this.data, o = this.n * FLOATS;
      d[o] = x; d[o + 1] = y; d[o + 2] = sx; d[o + 3] = sy;
      d[o + 4] = rot; d[o + 5] = 0; d[o + 6] = 0; d[o + 7] = 0;
      d[o + 8] = uv[0]; d[o + 9] = uv[1]; d[o + 10] = uv[2]; d[o + 11] = uv[3];
      d[o + 12] = r; d[o + 13] = g; d[o + 14] = b; d[o + 15] = a;
      this.n++;
    }
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.glw = new ZM.GL(canvas);
      this.gl = this.glw.gl;
      this.dpr = 1;
      this.init();
    }

    init() {
      const glw = this.glw, gl = this.gl, S = SH();
      this.progBg = glw.program(S.bgVS, S.bgFS, ['a_pos']);
      this.progGround = glw.program(S.groundVS, S.groundFS, ['a_pos']);
      this.progBlade = glw.program(S.bladeVS, S.bladeFS, ['a_pos', 'a_inst', 'a_rnd']);
      this.progSprite = glw.program(S.spriteVS, S.spriteFS, ['a_pos', 'a_i0', 'a_i1', 'a_i2', 'a_i3']);
      this.fsTri = glw.buffer(new Float32Array([-1, -1, 3, -1, -1, 3]));
      this.unitQuad = glw.buffer(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]));
      this.centerQuad = glw.buffer(new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]));
      // tapered blade: 5-vertex strip (side, t)
      this.bladeGeo = glw.buffer(new Float32Array([-1, 0, 1, 0, -0.62, 0.45, 0.62, 0.45, 0, 1]));
      this.batch = new SpriteBatch(glw, MAX_SPRITES);
      this.addBatch = new SpriteBatch(glw, 2500);
      this.textBatch = new SpriteBatch(glw, 2500);
      this.underBatch = new SpriteBatch(glw, 200);
      const atlas = ZM.buildAtlas();
      this.sprites = atlas.sprites;
      this.atlasTex = glw.canvasTexture(atlas.canvas, true);
      this.font = ZM.buildFont(ZM.fontFamily || 'sans-serif');
      this.fontTex = glw.canvasTexture(this.font.canvas, true);
      this.field = null;
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
    }

    resize(cssW, cssH, dpr) {
      this.dpr = dpr;
      const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w; this.canvas.height = h;
      }
      this.cssW = cssW; this.cssH = cssH;
    }

    // Upload a freshly generated level.
    setField(field) {
      const glw = this.glw, gl = this.gl;
      const lv = field.level;
      if (this.field) {
        for (const t of [this.terrainTex, this.stateTex, this.fxTex]) gl.deleteTexture(t);
        gl.deleteBuffer(this.bladeInst);
      }
      this.field = field;
      this.terrainTex = glw.texture(lv.TW, lv.TH, lv.terrain, true);
      this.stateTex = glw.texture(lv.W, lv.H, field.state, false);
      this.fxTex = glw.texture(lv.W, lv.H, field.fx, true);
      // blade instances sorted by root y so lower blades overlap upper tips
      const W = lv.W, H = lv.H;
      // big lawns: fewer but larger blades per cell, so the grass looks just as lush on
      // screen and the GPU draws about as many blades as on a small lawn
      const per = W <= 44 ? 4 : W <= 60 ? 3 : W <= 84 ? 2 : 1;
      this.bladeScale = Math.max(1, Math.min(2.3, Math.pow(W / 42, 0.9)));
      const r = ZM.rng(lv.seed);
      const list = [];
      for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
        if (!lv.grass[cy * W + cx]) continue;
        for (let k = 0; k < per; k++) {
          // stratified jitter keeps coverage even
          const jx = ((k % 2) + r()) / 2, jy = ((k >> 1) % 2 + r()) / 2;
          list.push([cx, cy, per === 4 ? jx : r(), per === 4 ? jy : r(), r(), r()]);
        }
      }
      list.sort((a, b) => a[1] + a[3] - (b[1] + b[3]));
      const inst = new Float32Array(list.length * 6);
      list.forEach((v, i) => inst.set(v, i * 6));
      this.bladeInst = glw.buffer(inst);
      this.bladeCount = list.length;
      this.bladeW = (per === 4 ? 0.2 : 0.23) * this.bladeScale;
    }

    uploadField() {
      const f = this.field;
      if (!f || !f.dirty) return;
      this.glw.update(this.stateTex, f.state);
      this.glw.update(this.fxTex, f.fx);
      f.dirty = false;
    }

    // camera fit: maps the field grid into the play rect (css px)
    computeView(game) {
      const lv = game.level, cw = this.canvas.width, ch = this.canvas.height, dpr = this.dpr;
      const pr = game.playRect;
      const pad = 10;
      const sw = (pr.w - pad * 2) / lv.W, shh = (pr.h - pad * 2) / lv.H;
      const scale = Math.min(sw, shh) * dpr; // device px per cell
      const offX = (pr.x + pr.w / 2) * dpr - (lv.W * scale) / 2;
      const offY = (pr.y + pr.h / 2) * dpr - (lv.H * scale) / 2;
      this.scale = scale; this.offX = offX; this.offY = offY;
      game.cam = { scale: scale / dpr, offX: offX / dpr, offY: offY / dpr };
      return [(2 * scale) / cw, (-2 * scale) / ch, (2 * offX) / cw - 1, 1 - (2 * offY) / ch];
    }

    render(game, time) {
      const gl = this.gl, glw = this.glw;
      const f = this.field;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      const biome = game.biome;
      const view = this.computeView(game);
      this.uploadField();

      // 1. background
      gl.disable(gl.BLEND);
      let P = this.progBg;
      gl.useProgram(P.p);
      gl.uniform3fv(P.u.u_top, biome.bg[0]);
      gl.uniform3fv(P.u.u_bot, biome.bg[1]);
      gl.uniform1f(P.u.u_time, time % 1000);
      gl.uniform1f(P.u.u_style, biome.bgStyle);
      gl.uniform2f(P.u.u_res, this.canvas.width, this.canvas.height);
      glw.attrib(0, this.fsTri, 2, 0, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!f) return;
      const lv = f.level;

      // 2. terrain / mowed ground
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      P = this.progGround;
      gl.useProgram(P.p);
      gl.uniform4fv(P.u.u_view, view);
      gl.uniform4f(P.u.u_rect, -3, -3, lv.W + 3, lv.H + 3);
      gl.uniform2f(P.u.u_grid, lv.W, lv.H);
      gl.uniform3fv(P.u.u_cutA, biome.cut[0]);
      gl.uniform3fv(P.u.u_cutB, biome.cut[1]);
      gl.uniform3fv(P.u.u_under, biome.under);
      gl.uniform3fv(P.u.u_rim, biome.rim);
      gl.uniform3fv(P.u.u_water, biome.water);
      gl.uniform3fv(P.u.u_stone, biome.stone);
      gl.uniform3fv(P.u.u_bed, biome.bed);
      gl.uniform1f(P.u.u_time, time % 1000);
      gl.uniform1f(P.u.u_clouds, biome.clouds);
      gl.uniform1f(P.u.u_aa, Math.min(0.2, 0.25 / Math.max(1, this.scale) * 1.2));
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.terrainTex);
      gl.uniform1i(P.u.u_terrain, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.fxTex);
      gl.uniform1i(P.u.u_fx, 1);
      glw.attrib(0, this.unitQuad, 2, 0, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // 3. buried treasures (drawn before grass so blades hide them)
      this.flushSprites(this.underBatch, view, false);

      // 4. grass blades
      gl.disable(gl.BLEND);
      P = this.progBlade;
      gl.useProgram(P.p);
      gl.uniform4fv(P.u.u_view, view);
      gl.uniform2f(P.u.u_grid, lv.W, lv.H);
      gl.uniform1f(P.u.u_time, time % 1000);
      gl.uniform4f(P.u.u_wind, game.wind[0], game.wind[1], game.wind[2], 0);
      gl.uniform4fv(P.u.u_mow, game.mowUniform);
      const pal = new Float32Array(21);
      for (let i = 0; i < 7; i++) pal.set(biome.blades[i], i * 3);
      gl.uniform3fv(P.u.u_pal, pal);
      gl.uniform3fv(P.u.u_root, biome.root);
      gl.uniform3fv(P.u.u_cutA, biome.cut[0]);
      gl.uniform3fv(P.u.u_cutB, biome.cut[1]);
      gl.uniform3fv(P.u.u_gold, biome.gold);
      gl.uniform1f(P.u.u_bladeH, 1.85 * this.bladeScale);
      gl.uniform1f(P.u.u_bladeW, this.bladeW);
      gl.uniform1f(P.u.u_grow, game.grow);
      gl.uniform1f(P.u.u_hint, game.hint);
      gl.uniform1f(P.u.u_clouds, biome.clouds);
      gl.uniform1f(P.u.u_glow, biome.glow);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
      gl.uniform1i(P.u.u_state, 0);
      glw.attrib(0, this.bladeGeo, 2, 0, 0, 0);
      glw.attrib(1, this.bladeInst, 4, 24, 0, 1);
      glw.attrib(2, this.bladeInst, 2, 24, 16, 1);
      glw.drawInstanced(gl.TRIANGLE_STRIP, 0, 5, this.bladeCount);
      glw.disableAttribs(1, 3);

      // 5. sprites & particles, additive glows, floating text
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.flushSprites(this.batch, view, false);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.flushSprites(this.addBatch, view, false);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.flushSprites(this.textBatch, view, true);
    }

    flushSprites(batch, view, isText) {
      if (batch.n === 0) return;
      const gl = this.gl, glw = this.glw, P = this.progSprite;
      gl.useProgram(P.p);
      gl.uniform4fv(P.u.u_view, view);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, isText ? this.fontTex : this.atlasTex);
      gl.uniform1i(P.u.u_tex, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, batch.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data.subarray(0, batch.n * FLOATS));
      glw.attrib(0, this.centerQuad, 2, 0, 0, 0);
      const stride = FLOATS * 4;
      glw.attrib(1, batch.buf, 4, stride, 0, 1);
      glw.attrib(2, batch.buf, 4, stride, 16, 1);
      glw.attrib(3, batch.buf, 4, stride, 32, 1);
      glw.attrib(4, batch.buf, 4, stride, 48, 1);
      glw.drawInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.n);
      glw.disableAttribs(1, 5);
    }

    // Text helper: centred string at world position, size in world units (cap height-ish).
    text(str, x, y, size, color, alpha, scaleX) {
      const g = this.font.glyphs;
      let w = 0;
      for (const ch of str) { const gl = g[ch] || g['?']; w += gl.adv; }
      let cx = x - (w * size) / 2;
      const sx = scaleX || 1;
      for (const ch of str) {
        const gl = g[ch] || g['?'];
        const gx = cx + (gl.adv * size) / 2;
        this.textBatch.push(x + (gx - x) * sx, y, gl.w * size * sx, gl.h * size, 0, gl.uv, color[0], color[1], color[2], alpha);
        cx += gl.adv * size;
      }
    }
  }
  ZM.Renderer = Renderer;
})(window.ZM);
