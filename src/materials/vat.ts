import { MeshStandardMaterial } from 'three';

/** A wet surface on the existing fill mesh; no extra transparent layers. */
export function createVatLiquid() {
  const time = { value: 0 };
  const activity = { value: 0 };
  const height = { value: 1 };
  const mat = new MeshStandardMaterial({
    color: 0x2fd47a,
    emissive: 0x0e6b38,
    roughness: 0.17,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uVatTime = time;
    shader.uniforms.uVatActivity = activity;
    shader.uniforms.uVatHeight = height;
    const declarations = `
      uniform float uVatTime;
      uniform float uVatActivity;
      uniform float uVatHeight;
      varying vec3 vVatLocal;
    `;
    shader.vertexShader = declarations + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vVatLocal = position;
      float surface = step(0.49, position.y);
      float wave = sin(position.x * 4.0 + uVatTime * 2.1)
        * cos(position.z * 3.0 - uVatTime * 1.7);
      // Keep the displacement in metres as the fill mesh grows. The
      // lower side stays anchored and an almost empty tank cannot invert.
      float amplitude = min(0.003, uVatHeight * 0.08) * uVatActivity;
      transformed.y += surface * wave * amplitude / max(0.0005, uVatHeight);
    `);
    shader.fragmentShader = declarations + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float surface = smoothstep(0.42, 0.49, vVatLocal.y);
      float radius = length(vVatLocal.xz);
      float ripples = sin(radius * 24.0 - uVatTime * 3.4
        + sin(vVatLocal.x * 5.0 + uVatTime) * 0.7);
      float crest = smoothstep(0.65, 1.0, ripples);
      float meniscus = smoothstep(0.86, 1.0, radius);
      diffuseColor.rgb += vec3(0.35, 0.65, 0.42) * surface
        * (crest * 0.18 * uVatActivity + meniscus * 0.22);
    `);
  };
  mat.customProgramCacheKey = () => 'vat-liquid-v1';
  return { mat, time, activity, height };
}
