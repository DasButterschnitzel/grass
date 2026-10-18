'use strict';
// GLSL sources. Written in the ES 3.00 subset that converts cleanly to ES 1.00.
(function (ZM) {
  const NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1.0,0.0)), u.x), mix(hash12(i+vec2(0.0,1.0)), hash12(i+vec2(1.0,1.0)), u.x), u.y); }
float fbm3(vec2 p){ return vnoise(p)*0.55 + vnoise(p*2.03+7.1)*0.3 + vnoise(p*4.1+3.7)*0.15; }
`;

  ZM.SHADERS = {
    bgVS: `
precision highp float;
in vec2 a_pos;
out vec2 v_uv;
void main(){ v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`,

    bgFS: `
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform vec3 u_top;
uniform vec3 u_bot;
uniform float u_time;
uniform float u_style;
uniform vec2 u_res;
${NOISE}
void main(){
  vec2 uv = v_uv;
  vec2 p = uv * u_res / min(u_res.x, u_res.y);
  vec3 col = mix(u_bot, u_top, smoothstep(0.0, 1.0, uv.y));
  float n = vnoise(p*2.2 + vec2(u_time*0.02, -u_time*0.015))*0.6 + vnoise(p*5.0 - u_time*0.03)*0.4;
  col *= 0.9 + 0.2*n;
  if (u_style < 0.5) {
    // garden: soft diagonal mown pattern + dappled light
    float d = sin((p.x + p.y)*26.0)*0.5+0.5;
    col *= 0.97 + 0.04*d;
    col += vec3(0.05,0.06,0.03) * smoothstep(0.6, 0.95, vnoise(p*3.0 + u_time*0.05));
  } else if (u_style < 1.5) {
    // night sky: twinkling stars
    vec2 g = floor(p*60.0);
    float h = hash12(g);
    float tw = 0.5 + 0.5*sin(u_time*(1.5+h*3.0) + h*40.0);
    float s = step(0.985, h) * smoothstep(0.35, 0.0, length(fract(p*60.0)-0.5)) * tw;
    col += vec3(0.8,0.9,1.0)*s*0.9;
    col += vec3(0.08,0.12,0.25) * smoothstep(0.4, 1.0, vnoise(p*1.5 + u_time*0.01));
  } else if (u_style < 2.5) {
    // ocean: caustics shimmer
    float c1 = vnoise(p*7.0 + vec2(u_time*0.25, u_time*0.1));
    float c2 = vnoise(p*7.0*1.3 - vec2(u_time*0.18, -u_time*0.22));
    float c = pow(1.0 - abs(c1 - c2), 8.0);
    col += vec3(0.25,0.55,0.6) * c * 0.45;
  } else if (u_style < 3.5) {
    // frost: drifting snow haze + sparkles
    col += vec3(0.12,0.16,0.2) * smoothstep(0.5, 1.0, vnoise(p*2.0 + vec2(u_time*0.04, u_time*0.08)));
    float h = hash12(floor(p*90.0));
    col += vec3(0.9) * step(0.993, h) * (0.5+0.5*sin(u_time*3.0 + h*50.0));
  } else {
    // neon: perspective-ish grid glow
    vec2 q = p*vec2(6.0, 6.0) + vec2(0.0, u_time*0.25);
    vec2 gl = abs(fract(q)-0.5);
    float line = smoothstep(0.47, 0.5, max(gl.x, gl.y));
    col += vec3(0.55,0.2,0.9) * line * 0.35 * (0.6 + 0.4*sin(u_time + p.y*3.0));
  }
  vec2 d = uv - 0.5;
  col *= 1.0 - dot(d*vec2(1.2,1.0), d*vec2(1.2,1.0))*1.1;
  fragColor = vec4(col, 1.0);
}`,

    groundVS: `
precision highp float;
in vec2 a_pos;
uniform vec4 u_view;
uniform vec4 u_rect;
out vec2 v_w;
void main(){ v_w = mix(u_rect.xy, u_rect.zw, a_pos); gl_Position = vec4(v_w*u_view.xy + u_view.zw, 0.0, 1.0); }`,

    groundFS: `
precision highp float;
in vec2 v_w;
out vec4 fragColor;
uniform sampler2D u_terrain;
uniform sampler2D u_fx;
uniform vec2 u_grid;
uniform vec3 u_cutA;
uniform vec3 u_cutB;
uniform vec3 u_under;
uniform vec3 u_rim;
uniform vec3 u_water;
uniform vec3 u_stone;
uniform vec3 u_bed;
uniform float u_time;
uniform float u_clouds;
uniform float u_aa;
uniform float u_night;
${NOISE}
vec4 ter(vec2 w){ return texture(u_terrain, w / u_grid); }
void main(){
  vec2 w = v_w;
  vec4 t = ter(w);
  // rim & shadow from distance-encoded land mask
  float land = smoothstep(0.5 - u_aa, 0.5 + u_aa, t.r);
  float sh = ter(w - vec2(0.45, 0.9)).r;
  float shadow = smoothstep(0.28, 0.62, sh) * 0.5;
  float rim = smoothstep(0.36, 0.47, t.r);
  vec3 rimCol = u_rim * (0.85 + 0.25*hash12(floor(w*3.0)));
  // rim lighting: top edge brighter
  float rl = ter(w + vec2(0.0, 0.25)).r - ter(w - vec2(0.0, 0.25)).r;
  rimCol *= 1.0 + rl*1.5;

  // mowed ground with stripes and grain
  vec4 fx = texture(u_fx, w / u_grid);
  float grain = hash12(floor(w*4.0));
  vec3 cut = mix(u_cutB*0.9, u_cutA*1.05, smoothstep(0.1, 0.9, fx.b)) * (0.965 + 0.07*grain);
  float unc = smoothstep(0.2, 0.8, fx.r);
  vec3 col = mix(cut, u_under*(0.88+0.14*grain), unc);
  col += vec3(fx.g) * 0.14 * (1.0 - unc);
  // soft inner edge darkening near the rim
  col *= 0.86 + 0.14*smoothstep(0.5, 0.62, t.r);

  // flower beds: rich soil
  float bed = smoothstep(0.5 - u_aa, 0.5 + u_aa, t.a);
  vec3 bedCol = u_bed * (0.8 + 0.3*hash12(floor(w*6.0)));
  bedCol *= 0.8 + 0.25*smoothstep(0.5, 0.7, t.a);
  col = mix(col, mix(u_rim, bedCol, smoothstep(0.5, 0.58, t.a)), bed);

  // ponds: depth, sandy shore, soft moving glints
  float depth = smoothstep(0.5, 0.95, t.g);
  vec3 wcol = mix(u_water*1.05, u_water*0.5, depth);
  float r1 = vnoise(w*0.7 + vec2(u_time*0.3, u_time*0.17));
  float r2 = vnoise(w*1.1 - vec2(u_time*0.21, -u_time*0.26));
  float glint = pow(1.0 - abs(r1 - r2), 14.0);
  wcol += vec3(0.75,0.9,1.0) * glint * 0.22 * (0.4 + 0.6*depth);
  wcol += vec3(1.0) * smoothstep(0.82, 1.0, vnoise(w*2.5 + u_time*0.4)) * 0.08;
  float shoreIn = smoothstep(0.5, 0.56, t.g);
  vec3 sand = mix(u_rim, vec3(0.93,0.86,0.68), 0.55);
  col = mix(col, mix(sand, wcol, shoreIn), smoothstep(0.44, 0.5, t.g));

  // stepping stones / rocks: flat tops with a bevelled, lit rim
  float stoneC = smoothstep(0.5 - u_aa, 0.5 + u_aa, t.b);
  float e = 0.22;
  float hx = smoothstep(0.5, 0.66, ter(w + vec2(e, 0.0)).b) - smoothstep(0.5, 0.66, ter(w - vec2(e, 0.0)).b);
  float hy = smoothstep(0.5, 0.66, ter(w + vec2(0.0, e)).b) - smoothstep(0.5, 0.66, ter(w - vec2(0.0, e)).b);
  vec3 nrm = normalize(vec3(-hx*1.6, -hy*1.6, 1.0));
  float lit = dot(nrm, normalize(vec3(-0.45, -0.6, 0.65)));
  float sn = vnoise(w*1.7) * 0.6 + vnoise(w*4.3) * 0.4;
  vec3 scol = u_stone * (0.72 + 0.35*lit) * (0.9 + 0.16*sn);
  scol = mix(scol * 0.7, scol, smoothstep(0.5, 0.56, t.b));
  // soft contact shadow below-right of stones
  float sAO = smoothstep(0.38, 0.52, ter(w - vec2(0.2, 0.35)).b) * (1.0 - stoneC);
  col *= 1.0 - sAO*0.3;
  col = mix(col, scol, stoneC);

  // drifting cloud shadows
  float cs = smoothstep(0.5, 0.78, fbm3(w*0.035 + vec2(u_time*0.018, u_time*0.009))) * 0.17 * u_clouds;
  col *= 1.0 - cs;

  vec3 outside = vec3(0.0);
  float a = land;
  vec3 c = col * land + rimCol * rim * (1.0 - land);
  float alpha = max(land, rim);
  // shadow only outside the rim
  float sa = shadow * (1.0 - alpha);
  fragColor = vec4(c, alpha + sa);
}`,

    bladeVS: `
precision highp float;
in vec2 a_pos;
in vec4 a_inst;
in vec2 a_rnd;
uniform sampler2D u_state;
uniform vec2 u_grid;
uniform vec4 u_view;
uniform float u_time;
uniform vec4 u_wind;
uniform vec4 u_mow[4];
uniform vec3 u_pal[7];
uniform vec3 u_root;
uniform vec3 u_cutA;
uniform vec3 u_cutB;
uniform vec3 u_gold;
uniform float u_bladeH;
uniform float u_bladeW;
uniform float u_grow;
uniform float u_hint;
uniform float u_clouds;
uniform float u_glow;
out vec3 v_col;
out float v_side;
out float v_t;
${NOISE}
vec3 pal(float i){
  vec3 c = u_pal[0];
  if (i > 0.5) c = u_pal[1];
  if (i > 1.5) c = u_pal[2];
  if (i > 2.5) c = u_pal[3];
  if (i > 3.5) c = u_pal[4];
  if (i > 4.5) c = u_pal[5];
  if (i > 5.5) c = u_pal[6];
  return c;
}
void main(){
  vec2 cell = a_inst.xy;
  vec4 st = texture(u_state, (cell + 0.5) / u_grid);
  v_side = a_pos.x; v_t = a_pos.y;
  if (st.a < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); v_col = vec3(0.0); return; }
  float hgt = st.r*255.0/20.0; // current grass height in layers – grows back continuously
  float typ = floor(st.g*255.0/40.0 + 0.5);
  vec2 root = cell + a_inst.zw;
  float rnd = a_rnd.x, rnd2 = a_rnd.y;
  float t = a_pos.y;
  float h; vec3 tip; vec3 base; float w = u_bladeW * (0.75 + 0.5*rnd2);
  float grow = clamp(u_grow*2.2 - (1.0 - root.y/u_grid.y)*1.0 - rnd*0.2, 0.0, 1.0);
  grow = grow*grow*(3.0-2.0*grow);
  vec3 cutCol = mix(u_cutB, u_cutA, rnd2) * (0.98 + 0.08*rnd);
  if (hgt < 0.1) {
    h = (0.12 + 0.14*rnd) * u_bladeH / 1.85;
    tip = cutCol;
    base = tip * 0.86;
    w *= 0.7;
  } else {
    float f = hgt < 1.0 ? 0.14 + 0.68*hgt : 0.82 + 0.2*(min(hgt, 5.0) - 1.0) + 0.06*max(hgt - 5.0, 0.0);
    h = u_bladeH * f * (0.78 + 0.44*rnd) * (0.08 + 0.92*grow);
    if (hgt < 1.0) {
      tip = mix(cutCol, pal(0.0), smoothstep(0.1, 0.95, hgt));
    } else {
      float li = min(hgt - 1.0, 6.0);
      float fl = floor(li);
      tip = mix(pal(fl), pal(min(fl + 1.0, 6.0)), smoothstep(0.0, 1.0, li - fl));
    }
    tip *= 0.9 + 0.2*rnd2;
    base = mix(u_root, tip, 0.18 + 0.5*(1.0 - min(hgt, 1.0)));
    w *= 0.7 + 0.3*min(hgt, 1.0);
    if (typ > 0.5 && typ < 1.5) {
      float sh = 0.85 + 0.3*sin(u_time*3.5 + rnd*6.283 + root.x*0.4);
      tip = u_gold * sh;
      base = u_gold * 0.55;
    }
    float hp = 0.5 + 0.5*sin(u_time*4.5 + root.x*0.25 + root.y*0.18);
    tip += u_hint * 0.35 * hp;
  }
  // wind: slow sway + rolling gusts
  float gust = smoothstep(0.42, 0.9, vnoise(root*0.07 - u_wind.xy*u_time*0.55));
  float sway = sin(u_time*1.7 + rnd*6.283 + dot(root, vec2(0.21, 0.13)))*0.1 + gust*u_wind.z;
  vec2 lean = vec2((rnd2 - 0.5)*0.55, 0.0) + u_wind.xy*sway;
  // mowers push the grass around them
  for (int i = 0; i < 4; i++) {
    vec4 m = u_mow[i];
    if (m.w > 0.5) {
      vec2 d = root - m.xy;
      float r = length(d);
      float R = m.z*1.9 + 1.0;
      if (r < R && r > 0.001) lean += d / r * (1.0 - r/R) * 1.3;
    }
  }
  float bend = clamp(length(lean), 0.0, 1.4);
  vec2 off = vec2(lean.x, lean.y*0.6) * h * 0.85;
  float vy = -h * (1.0 - 0.35*bend*bend*0.5);
  vec2 p = root + vec2(0.0, vy)*t + off*t*t;
  vec2 tng = normalize(vec2(0.0, vy) + 2.0*off*t + vec2(0.0001, 0.0));
  vec2 nrm = vec2(-tng.y, tng.x);
  p += nrm * w * a_pos.x;
  // shading: dark roots, sunlit tips, gust highlights, cloud shadows
  vec3 col = mix(base, tip, pow(t, 0.75));
  col *= 1.0 + gust*0.12*t;
  float cs = smoothstep(0.5, 0.78, fbm3(root*0.035 + vec2(u_time*0.018, u_time*0.009))) * 0.17 * u_clouds;
  col *= 1.0 - cs;
  col += tip * u_glow * t * t * 0.45;
  v_col = col;
  gl_Position = vec4(p*u_view.xy + u_view.zw, 0.0, 1.0);
}`,

    bladeFS: `
precision mediump float;
in vec3 v_col;
in float v_side;
in float v_t;
out vec4 fragColor;
void main(){
  float edge = 1.0 - 0.28*v_side*v_side;
  fragColor = vec4(v_col*edge, 1.0);
}`,

    spriteVS: `
precision highp float;
in vec2 a_pos;
in vec4 a_i0;
in vec4 a_i1;
in vec4 a_i2;
in vec4 a_i3;
uniform vec4 u_view;
out vec2 v_uv;
out vec4 v_col;
void main(){
  float c = cos(a_i1.x), s = sin(a_i1.x);
  vec2 q = a_pos * a_i0.zw;
  vec2 p = a_i0.xy + vec2(q.x*c - q.y*s, q.x*s + q.y*c);
  v_uv = mix(a_i2.xy, a_i2.zw, a_pos + 0.5);
  v_col = vec4(a_i3.rgb * a_i3.a, a_i3.a);
  gl_Position = vec4(p*u_view.xy + u_view.zw, 0.0, 1.0);
}`,

    spriteFS: `
precision mediump float;
in vec2 v_uv;
in vec4 v_col;
uniform sampler2D u_tex;
out vec4 fragColor;
void main(){ fragColor = texture(u_tex, v_uv) * v_col; }`,
  };
})(window.ZM);
