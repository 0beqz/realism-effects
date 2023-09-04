// source:
// https://github.com/mrdoob/three.js/blob/342946c8392639028da439b6dc0597e58209c696/examples/js/shaders/SAOShader.js#L123
float getViewZ(const in float depth) {
#ifdef PERSPECTIVE_CAMERA
  return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
#else
  return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
#endif
}

// source:
// https://github.com/mrdoob/three.js/blob/dev/examples/js/shaders/SSAOShader.js
vec3 getViewPosition(float viewZ) {
  float clipW = projectionMatrix[2][3] * viewZ + projectionMatrix[3][3];
  vec4 clipPosition = vec4((vec3(vUv, viewZ) - 0.5) * 2.0, 1.0);
  clipPosition *= clipW;
  vec3 p = (projectionMatrixInverse * clipPosition).xyz;
  p.z = -viewZ;
  return p;
}

vec3 F_Schlick(const vec3 f0, const float theta) {
  return f0 + (1. - f0) * pow(1.0 - theta, 5.);
}

vec3 SampleGGXVNDF(const vec3 V, const float ax, const float ay, const float r1,
                   const float r2) {
  vec3 Vh = normalize(vec3(ax * V.x, ay * V.y, V.z));

  float lensq = Vh.x * Vh.x + Vh.y * Vh.y;
  vec3 T1 = lensq > 0. ? vec3(-Vh.y, Vh.x, 0.) * inversesqrt(lensq)
                       : vec3(1., 0., 0.);
  vec3 T2 = cross(Vh, T1);

  float r = sqrt(r1);
  float phi = 2.0 * PI * r2;
  float t1 = r * cos(phi);
  float t2 = r * sin(phi);
  float s = 0.5 * (1.0 + Vh.z);
  t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

  vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * Vh;

  return normalize(vec3(ax * Nh.x, ay * Nh.y, max(0.0, Nh.z)));
}

void Onb(const vec3 N, inout vec3 T, inout vec3 B) {
  vec3 up = abs(N.z) < 0.9999999 ? vec3(0, 0, 1) : vec3(1, 0, 0);
  T = normalize(cross(up, N));
  B = cross(N, T);
}

vec3 ToLocal(const vec3 X, const vec3 Y, const vec3 Z, const vec3 V) {
  return vec3(dot(V, X), dot(V, Y), dot(V, Z));
}

vec3 ToWorld(const vec3 X, const vec3 Y, const vec3 Z, const vec3 V) {
  return V.x * X + V.y * Y + V.z * Z;
}

vec3 constructGlobalIllumination(vec3 diffuseGi, vec3 specularGi,
                                 vec3 cameraRay, vec3 viewNormal, vec3 diffuse,
                                 vec3 emissive, float roughness,
                                 float metalness) {
  roughness *= roughness;

  // convert the viewNormal to world-space
  vec3 normal = (vec4(viewNormal, 0.) * viewMatrix).xyz;

  vec3 T, B;

  vec3 v = -cameraRay; // incoming vector

  // convert view dir and view normal to world-space
  vec3 V = (vec4(v, 0.) * viewMatrix).xyz; // invert view dir
  vec3 N = normal;

  Onb(N, T, B);

  V = ToLocal(T, B, N, V);

  // seems to approximate Fresnel very well
  vec3 H = SampleGGXVNDF(V, roughness, roughness, 0.25, 0.25);
  if (H.z < 0.0)
    H = -H;

  vec3 l = normalize(reflect(-V, H));
  l = ToWorld(T, B, N, l);

  // convert reflected vector back to view-space
  l = (vec4(l, 1.) * cameraMatrixWorld).xyz;
  l = normalize(l);

  if (dot(viewNormal, l) < 0.)
    l = -l;

  vec3 h = normalize(v + l); // half vector

  // try to approximate the fresnel term we get when accumulating over multiple
  // frames
  float VoH = max(EPSILON, dot(v, h));

  vec3 diffuseColor = diffuseGi;
  vec3 specularColor = specularGi;

  // fresnel
  vec3 f0 = mix(vec3(0.04), diffuse, metalness);
  vec3 F = F_Schlick(f0, VoH);

  vec3 diffuseLightingColor = diffuseColor;
  vec3 diffuseComponent =
      diffuse * (1. - metalness) * (1. - F) * diffuseLightingColor;

  vec3 specularLightingColor = specularColor;
  vec3 specularComponent = specularLightingColor * F;

  // ! todo: fix direct light
  // vec3 directLight = textureLod(directLightTexture, vUv, 0.).rgb;

  vec3 globalIllumination = diffuseComponent + specularComponent + emissive;

  return globalIllumination;
}