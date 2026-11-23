/* Шейдери вогняної кулі. Звичайні GLSL-рядки — без сторонніх залежностей. */

/** Об'ємна куля: вершинний шейдер малює back-faces бокса навколо кулі. */
export const fireVert = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/** Raymarching порожньої оболонки з волокнистими язиками, з урахуванням depth сцени. */
export const fireFrag = /* glsl */ `
  precision highp float;
  #include <packing>

  uniform float uTime;
  uniform float uReveal;
  uniform vec3  uCenter;     // центр кулі (світ)
  uniform float uScale;      // радіус кулі (світ)
  uniform float uMode;       // 0 — куля, 1 — стіна вогню
  uniform vec3  uBounds;     // піврозміри об'єму стіни у світових координатах
  uniform float uIntensity;
  uniform float uTurb;
  uniform float uFlame;
  uniform float uSharp;
  uniform float uCore;
  uniform vec3  uC1;
  uniform vec3  uC2;
  uniform vec3  uC3;
  uniform vec3  uC4;
  uniform sampler2D uDepth;
  uniform vec2  uRes;
  uniform vec3  uCamForward;
  uniform float uNear;
  uniform float uFar;
  varying vec3  vWorld;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i),               hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float fbm4(vec3 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return v;
  }
  float fbm3(vec3 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec3(4.3, 1.1, 6.7);
      a *= 0.5;
    }
    return v;
  }

  vec3 fireColor(float I) {
    vec3 c = mix(vec3(0.0), uC1, smoothstep(0.04, 0.30, I));
    c = mix(c, uC2, smoothstep(0.25, 0.55, I));
    c = mix(c, uC3, smoothstep(0.50, 0.85, I));
    c = mix(c, uC4, smoothstep(0.85, 1.30, I));
    return c;
  }

  // pl — точка у локальних координатах кулі (радіус кулі = 1, вісь Y — вгору)
  // x = щільність, y = температура
  vec2 field(vec3 pl) {
    float r0 = length(pl);
    if (r0 > 2.6 || r0 < 0.8) return vec2(0.0);
    float t = uTime;

    vec3 dir = pl / max(r0, 1e-4);
    float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);   // 0 — низ кулі, 1 — верх

    // domain warping, стадія 1: великі повільні завихрення, що біжать угору
    vec3 flow = vec3(0.0, -t * 1.5, 0.0);
    vec3 w1 = vec3(noise(pl * 1.2 + flow),
                   noise(pl * 1.2 + flow + vec3(5.2, 1.3, 7.7)),
                   noise(pl * 1.2 + flow + vec3(2.1, 9.4, 3.3))) - 0.5;
    vec3 q = pl + w1 * uTurb * (0.4 + 1.0 * up);

    // стадія 2: дрібні завитки — «волокниста» структура
    vec3 flow2 = vec3(0.0, -t * 2.2, 0.0);
    vec3 w2 = vec3(noise(q * 3.0 + flow2 + vec3(1.7, 9.2, 3.1)),
                   noise(q * 3.0 + flow2 + vec3(8.3, 2.8, 5.5)),
                   noise(q * 3.0 + flow2 + vec3(4.4, 6.1, 0.9))) - 0.5;
    q += w2 * uTurb * 0.35;

    // маска язиків: повільний високий шум вирішує, де полум'я тягнеться далеко
    float mask = fbm3(vec3(q.x * 1.5, q.y * 0.55 - t * 1.3, q.z * 1.5));
    float tongue = smoothstep(0.38, 0.72, mask);

    // відстань від поверхні та довжина язика (різна для кожного, угорі більша)
    float s = length(q) - 1.0;
    float T = (0.10 + 0.22 * up + 0.55 * tongue * (0.5 + 0.8 * up)) * uFlame;
    float x = s / T;
    float inner = smoothstep(-0.10, 0.03, s);                 // всередині порожньо
    float shape = inner * (1.0 - smoothstep(0.0, 1.0, x));    // 1 на поверхні → 0 на краю

    // вертикально витягнутий шум розрізає язики на пасма
    float n = fbm4(vec3(q.x * 2.4, q.y * 1.2 - t * 2.8, q.z * 2.4));
    float d = clamp(shape * 1.4 - n * (0.25 + 0.95 * clamp(x, 0.0, 1.0)), 0.0, 1.0);

    // тонкі яскраві нитки (ridged noise)
    float rid = 1.0 - abs(2.0 * fbm3(vec3(q.x * 3.4, q.y * 1.6 - t * 3.6, q.z * 3.4)) - 1.0);
    rid = pow(rid, uSharp);
    float tend = rid * smoothstep(0.0, 0.5, shape) * (0.6 + 0.8 * tongue);

    float dens = pow(d, 1.25) * 0.85 + tend * 0.8 * shape;

    // температура падає від поверхні до кінчиків: жовтий низ → червоне тіло → темно-червоні кінці
    float xc = clamp(x, 0.0, 1.0);
    float temp = clamp(pow(1.0 - xc, 1.3) * 0.95 + d * 0.25 + tend * 0.15, 0.0, 1.3);
    return vec2(dens, temp);
  }

  vec2 wallField(vec3 p) {
    float height = clamp(p.y * 0.5 + 0.5, 0.0, 1.0);
    float side = abs(p.x);
    float depth = abs(p.z);
    float slow = fbm3(vec3(p.x * 2.7, -uTime * 0.55, p.z * 1.8));
    float crown = clamp((0.24 + slow * 0.76) * uFlame, 0.16, 1.0);
    float top = 1.0 - smoothstep(crown - 0.12, crown, height);
    float foot = smoothstep(0.0, 0.08, height);
    float edges = 1.0 - smoothstep(0.88, 1.0, side);
    float bodyDepth = 1.0 - smoothstep(0.62, 1.0, depth);
    float flow = fbm4(vec3(p.x * (3.0 + uTurb), height * 2.8 - uTime * 2.0, p.z * (2.4 + uTurb)));
    float cut = fbm3(vec3(p.x * (4.2 + uTurb), height * 2.0 - uTime * 2.8, p.z * 4.0));
    float ridges = pow(1.0 - abs(2.0 * fbm3(vec3(p.x * 5.8, height * 2.2 - uTime * 3.2, p.z * 5.0)) - 1.0), uSharp);
    float density = clamp((0.32 + flow * 1.15 - cut * 0.48) * top * foot * edges * bodyDepth, 0.0, 1.0);
    density += ridges * top * foot * edges * bodyDepth * 0.28;
    float heat = clamp((1.0 - height) * 0.82 + density * 0.34 + ridges * 0.12, 0.0, 1.3);
    return vec2(density, heat);
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - ro);

    float tn;
    float tf;
    if (uMode < 0.5) {
      vec3 oc = ro - uCenter;
      float radius = uScale * 2.6;
      float b = dot(oc, rd);
      float c = dot(oc, oc) - radius * radius;
      float disc = b * b - c;
      if (disc <= 0.0) discard;
      float root = sqrt(disc);
      tn = max(-b - root, 0.0);
      tf = -b + root;
    } else {
      vec3 inv = (step(vec3(0.0), rd) * 2.0 - 1.0) / max(abs(rd), vec3(0.0001));
      vec3 t0 = (uCenter - uBounds - ro) * inv;
      vec3 t1 = (uCenter + uBounds - ro) * inv;
      vec3 nearT = min(t0, t1);
      vec3 farT = max(t0, t1);
      tn = max(max(nearT.x, nearT.y), max(nearT.z, 0.0));
      tf = min(min(farT.x, farT.y), farT.z);
    }
    if (tf <= tn) discard;

    // глибина непрозорої сцени: вогонь не малюється за персонажем
    vec2 suv = gl_FragCoord.xy / uRes;
    float dep = texture2D(uDepth, suv).x;
    float viewZ = perspectiveDepthToViewZ(dep, uNear, uFar);
    float ts = -viewZ / max(dot(rd, uCamForward), 1e-3);
    tf = min(tf, ts);
    if (tf <= tn) discard;

    const int STEPS = 52;   // зменшіть до 36, якщо важко відеокарті
    float dt = (tf - tn) / float(STEPS);
    float dl = dt / uScale;
    float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float t = tn + dt * jit;

    vec3 col = vec3(0.0);
    for (int i = 0; i < STEPS; i++) {
      vec3 local = ro + rd * t - uCenter;
      vec3 pl = uMode < 0.5 ? local / uScale : local / uBounds;
      float r0 = length(pl);
      if (uMode < 0.5 && r0 < 1.0) col += uC1 * uCore * dl * (1.0 - r0);   // слабке світіння всередині кулі
      vec2 f = uMode < 0.5 ? field(pl) : wallField(pl);
      if (f.x > 0.002) col += fireColor(f.y) * f.x * dl * 5.0 * uIntensity;
      t += dt;
    }
    gl_FragColor = vec4(col * uReveal, 1.0);
  }
`;

/** Іскри: рух повністю рахується у вершинному шейдері. */
export const sparkVert = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uPx;
  uniform float uScale;
  uniform float uSparkSize;
  uniform vec3  uCenter;
  varying float vLife;
  void main() {
    float speed = 0.12 + 0.20 * aSeed.x;
    float life = fract(uTime * speed + aSeed.y);
    float th = aSeed.z * 6.2831853;
    float ph = acos(1.0 - 1.6 * aSeed.w);            // зміщено до верхньої півкулі
    vec3 dir = vec3(sin(ph) * cos(th), cos(ph), sin(ph) * sin(th));
    vec3 p = dir * 1.02;
    p.y += life * (1.0 + 2.4 * aSeed.x);
    p.xz += dir.xz * life * 0.6
          + vec2(sin(life * 8.0 + aSeed.z * 30.0), cos(life * 7.0 + aSeed.w * 25.0)) * 0.25 * life;
    vLife = life;
    vec4 mv = viewMatrix * vec4(uCenter + p * uScale, 1.0);
    gl_PointSize = uSparkSize * uScale * (0.075 + 0.08 * aSeed.x) * uPx / -mv.z * (1.0 - life * 0.7);
    gl_Position = projectionMatrix * mv;
  }
`;

export const sparkFrag = /* glsl */ `
  uniform float uReveal;
  uniform float uSparkShape;
  varying float vLife;
  void main() {
    vec2 uv = abs(gl_PointCoord - 0.5);
    float d = length(uv);
    if (uSparkShape > 0.5 && uSparkShape < 1.5) d = uv.x + uv.y;
    if (uSparkShape > 1.5) d = max(uv.y * 1.5, uv.x * 0.35);
    float edge = uSparkShape > 0.5 && uSparkShape < 1.5 ? 0.72 : 0.5;
    float a = 1.0 - smoothstep(0.0, edge, d);
    a *= a;
    vec3 col = mix(vec3(1.0, 0.70, 0.25), vec3(1.0, 0.16, 0.02), vLife);
    gl_FragColor = vec4(col * 2.8, a * (1.0 - vLife) * uReveal);
  }
`;
