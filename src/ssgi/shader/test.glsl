#define GLSLIFY                                                                                                                                      \
  1\nvarying vec2 vUv;                                                                                                                               \
  uniform sampler2D accumulatedTexture;                                                                                                              \
  uniform highp sampler2D depthTexture;                                                                                                              \
  uniform highp sampler2D velocityTexture;                                                                                                           \
  uniform sampler2D directLightTexture;                                                                                                              \
  uniform vec3 backgroundColor;                                                                                                                      \
  uniform mat4 projectionMatrix;                                                                                                                     \
  uniform mat4 projectionMatrixInverse;                                                                                                              \
  uniform mat4 cameraMatrixWorld;                                                                                                                    \
  uniform float maxEnvMapMipLevel;                                                                                                                   \
  uniform float rayDistance;                                                                                                                         \
  uniform float thickness;                                                                                                                           \
  uniform float envBlur;                                                                                                                             \
  uniform vec2 resolution;                                                                                                                           \
  uniform float cameraNear;                                                                                                                          \
  uniform float cameraFar;                                                                                                                           \
  uniform float nearMinusFar;                                                                                                                        \
  uniform float nearMulFar;                                                                                                                          \
  uniform float farMinusNear;                                                                                                                        \
  struct EquirectHdrInfo {                                                                                                                           \
    sampler2D marginalWeights;                                                                                                                       \
    sampler2D conditionalWeights;                                                                                                                    \
    sampler2D map;                                                                                                                                   \
    vec2 size;                                                                                                                                       \
    float totalSumWhole;                                                                                                                             \
    float totalSumDecimal;                                                                                                                           \
  };                                                                                                                                                 \
  uniform EquirectHdrInfo envMapInfo;                                                                                                                \
  \n #define INVALID_RAY_COORDS vec2(-1.0);                                                                                                          \
  \n #define EPSILON 0.00001\n #define ONE_MINUS_EPSILON 1.0 - EPSILON\nvec2 invTexSize;                                                             \
  \n #define MODE_SSGI 0\n #define MODE_SSR 1\n #include<packing>\n #include<gbuffer_packing>\n #include<ssgi_utils>\nvec2 RayMarch(                 \
      inout vec3 dir, inout vec3 hitPos, vec4 random);                                                                                               \
  vec2 BinarySearch(inout vec3 dir, inout vec3 hitPos);                                                                                              \
  struct RayTracingInfo {                                                                                                                            \
    float NoV;                                                                                                                                       \
    float NoL;                                                                                                                                       \
    float NoH;                                                                                                                                       \
    float LoH;                                                                                                                                       \
    float VoH;                                                                                                                                       \
    bool isDiffuseSample;                                                                                                                            \
    bool isEnvSample;                                                                                                                                \
  };                                                                                                                                                 \
  struct RayTracingResult {                                                                                                                          \
    vec3 gi;                                                                                                                                         \
    vec3 l;                                                                                                                                          \
    vec3 hitPos;                                                                                                                                     \
    bool isMissedRay;                                                                                                                                \
    vec3 brdf;                                                                                                                                       \
    float pdf;                                                                                                                                       \
  };                                                                                                                                                 \
  struct EnvMisSample {                                                                                                                              \
    float pdf;                                                                                                                                       \
    float probability;                                                                                                                               \
    bool isEnvSample;                                                                                                                                \
  };                                                                                                                                                 \
  vec3 worldNormal;                                                                                                                                  \
  vec3 doSample(const vec3 viewPos, const vec3 viewDir, const vec3 viewNormal, const vec3 worldPos, const float metalness, const float roughness,    \
                const bool isDiffuseSample, const bool isEnvSample, const float NoV, const float NoL, const float NoH, const float LoH,              \
                const float VoH, const vec4 random, inout vec3 l, inout vec3 hitPos, out bool isMissedRay, out vec3 brdf, out float pdf);            \
  void calculateAngles(inout vec3 h, inout vec3 l, inout vec3 v, inout vec3 n, inout float NoL, inout float NoH, inout float LoH, inout float VoH) { \
    h = normalize(v + l);                                                                                                                            \
    NoL = clamp(dot(n, l), EPSILON, ONE_MINUS_EPSILON);                                                                                              \
    NoH = clamp(dot(n, h), EPSILON, ONE_MINUS_EPSILON);                                                                                              \
    LoH = clamp(dot(l, h), EPSILON, ONE_MINUS_EPSILON);                                                                                              \
    VoH = clamp(dot(v, h), EPSILON, ONE_MINUS_EPSILON);                                                                                              \
  }                                                                                                                                                  \
  vec3 worldPos;                                                                                                                                     \
  Material mat;                                                                                                                                      \
  void main() {                                                                                                                                      \
    float unpackedDepth = textureLod(depthTexture, vUv, 0.0).r;                                                                                      \
    if (unpackedDepth == 1.0) {                                                                                                                      \
      vec4 directLight = textureLod(directLightTexture, vUv, 0.0);                                                                                   \
      gl_FragColor = packTwoVec4(directLight, directLight);                                                                                          \
      return;                                                                                                                                        \
    }                                                                                                                                                \
    mat = getMaterial(gBufferTexture, vUv);                                                                                                          \
    float roughnessSq = clamp(mat.roughness * mat.roughness, 0.000001, 1.0);                                                                         \
    invTexSize = 1. / resolution;                                                                                                                    \
    float viewZ = getViewZ(unpackedDepth);                                                                                                           \
    vec3 viewPos = getViewPosition(viewZ);                                                                                                           \
    vec3 viewDir = normalize(viewPos);                                                                                                               \
    worldNormal = mat.normal;                                                                                                                        \
    vec3 viewNormal = normalize((vec4(worldNormal, 0.) * cameraMatrixWorld).xyz);                                                                    \
    worldPos = (cameraMatrixWorld * vec4(viewPos, 1.)).xyz;                                                                                          \
    vec3 n = viewNormal;                                                                                                                             \
    vec3 v = -viewDir;                                                                                                                               \
    float NoV = max(EPSILON, dot(n, v));                                                                                                             \
    vec3 V = (vec4(v, 0.) * viewMatrix).xyz;                                                                                                         \
    vec3 N = worldNormal;                                                                                                                            \
    vec4 random;                                                                                                                                     \
    vec3 H, l, h, F, T, B, envMisDir, gi;                                                                                                            \
    vec3 diffuseGI, specularGI, brdf, hitPos, specularHitPos;                                                                                        \
    Onb(N, T, B);                                                                                                                                    \
    V = ToLocal(T, B, N, V);                                                                                                                         \
    vec3 f0 = mix(vec3(0.04), mat.diffuse.rgb, mat.metalness);                                                                                       \
    float NoL, NoH, LoH, VoH, diffW, specW, invW, pdf, envPdf, diffuseSamples, specularSamples;                                                      \
    bool isDiffuseSample, isEnvSample, isMissedRay;                                                                                                  \
    random = blueNoise();                                                                                                                            \
    H = SampleGGXVNDF(V, roughnessSq, roughnessSq, random.r, random.g);                                                                              \
    if (H.z < 0.0)                                                                                                                                   \
      H = -H;                                                                                                                                        \
    l = normalize(reflect(-V, H));                                                                                                                   \
    l = ToWorld(T, B, N, l);                                                                                                                         \
    l = (vec4(l, 0.) * cameraMatrixWorld).xyz;                                                                                                       \
    l = normalize(l);                                                                                                                                \
    calculateAngles(h, l, v, n, NoL, NoH, LoH, VoH);                                                                                                 \
    \n #if mode == MODE_SSGI\nF = F_Schlick(f0, VoH);                                                                                                \
    diffW = (1. - mat.metalness) * luminance(mat.diffuse.rgb);                                                                                       \
    specW = luminance(F);                                                                                                                            \
    diffW = max(diffW, EPSILON);                                                                                                                     \
    specW = max(specW, EPSILON);                                                                                                                     \
    invW = 1. / (diffW + specW);                                                                                                                     \
    diffW *= invW;                                                                                                                                   \
    isDiffuseSample = random.b < diffW;                                                                                                              \
    \n #else \nisDiffuseSample = false;                                                                                                              \
    \n #endif \nEnvMisSample ems;                                                                                                                    \
    ems.pdf = 1.;                                                                                                                                    \
    envMisDir = vec3(0.0);                                                                                                                           \
    envPdf = 1.;                                                                                                                                     \
    \n #ifdef importanceSampling\nems.pdf = sampleEquirectProbability(envMapInfo, random.rg, envMisDir);                                             \
    envMisDir = normalize((vec4(envMisDir, 0.) * cameraMatrixWorld).xyz);                                                                            \
    ems.probability = dot(envMisDir, viewNormal);                                                                                                    \
    ems.probability *= mat.roughness;                                                                                                                \
    ems.probability = min(ONE_MINUS_EPSILON, ems.probability);                                                                                       \
    ems.isEnvSample = random.a < ems.probability;                                                                                                    \
    if (ems.isEnvSample) {                                                                                                                           \
      ems.pdf /= 1. - ems.probability;                                                                                                               \
      l = envMisDir;                                                                                                                                 \
      calculateAngles(h, l, v, n, NoL, NoH, LoH, VoH);                                                                                               \
    } else {                                                                                                                                         \
      ems.pdf = 1. - ems.probability;                                                                                                                \
    }                                                                                                                                                \
    \n #endif \nvec3 diffuseRay = ems.isEnvSample ? envMisDir : cosineSampleHemisphere(viewNormal, random.rg);                                       \
    vec3 specularRay = ems.isEnvSample ? envMisDir : l;                                                                                              \
    \n #if mode == MODE_SSGI\nif(isDiffuseSample) {                                                                                                  \
      l = diffuseRay;                                                                                                                                \
      calculateAngles(h, l, v, n, NoL, NoH, LoH, VoH);                                                                                               \
      gi = doSample(viewPos, viewDir, viewNormal, worldPos, mat.metalness, roughnessSq, isDiffuseSample, ems.isEnvSample, NoV, NoL, NoH, LoH, VoH,   \
                    random, l, hitPos, isMissedRay, brdf, pdf);                                                                                      \
      gi *= brdf;                                                                                                                                    \
      if (ems.isEnvSample) {                                                                                                                         \
        gi *= misHeuristic(ems.pdf, pdf);                                                                                                            \
      } else {                                                                                                                                       \
        gi /= pdf;                                                                                                                                   \
      }                                                                                                                                              \
      gi /= ems.pdf;                                                                                                                                 \
      diffuseSamples++;                                                                                                                              \
      diffuseGI = mix(diffuseGI, gi, 1. / diffuseSamples);                                                                                           \
    }                                                                                                                                                \
    \n #endif \nl = specularRay;                                                                                                                     \
    calculateAngles(h, l, v, n, NoL, NoH, LoH, VoH);                                                                                                 \
    gi = doSample(viewPos, viewDir, viewNormal, worldPos, mat.metalness, roughnessSq, isDiffuseSample, ems.isEnvSample, NoV, NoL, NoH, LoH, VoH,     \
                  random, l, hitPos, isMissedRay, brdf, pdf);                                                                                        \
    gi *= brdf;                                                                                                                                      \
    if (ems.isEnvSample) {                                                                                                                           \
      gi *= misHeuristic(ems.pdf, pdf);                                                                                                              \
    } else {                                                                                                                                         \
      gi /= pdf;                                                                                                                                     \
    }                                                                                                                                                \
    gi /= ems.pdf;                                                                                                                                   \
    specularHitPos = hitPos;                                                                                                                         \
    specularSamples++;                                                                                                                               \
    specularGI = mix(specularGI, gi, 1. / specularSamples);                                                                                          \
    \n #ifdef useDirectLight\nvec3 directLight = textureLod(directLightTexture, vUv, 0.).rgb;                                                        \
    diffuseGI += directLight;                                                                                                                        \
    specularGI += directLight;                                                                                                                       \
    \n #endif \nhighp vec4 gDiffuse, gSpecular;                                                                                                      \
    \n #if mode == MODE_SSGI\nif(diffuseSamples == 0.0) diffuseGI = vec3(-1.0);                                                                      \
    gDiffuse = vec4(diffuseGI, mat.roughness);                                                                                                       \
    \n #endif \nhighp float rayLength = 0.0;                                                                                                         \
    vec4 hitPosWS;                                                                                                                                   \
    vec3 cameraPosWS = cameraMatrixWorld[3].xyz;                                                                                                     \
    isMissedRay = hitPos.x > 10.0e8;                                                                                                                 \
    if (!isMissedRay) {                                                                                                                              \
      hitPosWS = cameraMatrixWorld * vec4(specularHitPos, 1.0);                                                                                      \
      rayLength = distance(cameraPosWS, hitPosWS.xyz);                                                                                               \
    }                                                                                                                                                \
    highp uint packedRoughnessRayLength = packHalf2x16(vec2(rayLength, mat.roughness));                                                              \
    highp float a = uintBitsToFloat(packedRoughnessRayLength);                                                                                       \
    \n #if mode == MODE_SSGI\ngSpecular = vec4(specularGI, rayLength);                                                                               \
    gl_FragColor = packTwoVec4(gDiffuse, gSpecular);                                                                                                 \
    \n #else \ngSpecular = vec4(specularGI, a);                                                                                                      \
    gl_FragColor = gSpecular;                                                                                                                        \
    \n #endif \n                                                                                                                                     \
  }                                                                                                                                                  \
  vec3 getEnvColor(vec3 l, vec3 worldPos, float roughness, bool isDiffuseSample, bool isEnvSample) {                                                 \
    vec3 envMapSample;                                                                                                                               \
    \n #ifdef USE_ENVMAP\nvec3 reflectedWS = normalize((vec4(l, 0.) * viewMatrix).xyz);                                                              \
    \n #ifdef BOX_PROJECTED_ENV_MAP\nreflectedWS = parallaxCorrectNormal(reflectedWS.xyz, envMapSize, envMapPosition, worldPos);                     \
    reflectedWS = normalize(reflectedWS.xyz);                                                                                                        \
    \n #endif \nfloat mip = envBlur * maxEnvMapMipLevel;                                                                                             \
    if (!isDiffuseSample && roughness < 0.15)                                                                                                        \
      mip *= roughness / 0.15;                                                                                                                       \
    envMapSample = sampleEquirectEnvMapColor(reflectedWS, envMapInfo.map, mip);                                                                      \
    float maxEnvLum = isEnvSample ? 100.0 : 25.0;                                                                                                    \
    if (maxEnvLum != 0.0) {                                                                                                                          \
      float envLum = luminance(envMapSample);                                                                                                        \
      if (envLum > maxEnvLum) {                                                                                                                      \
        envMapSample *= maxEnvLum / envLum;                                                                                                          \
      }                                                                                                                                              \
    }                                                                                                                                                \
    return envMapSample;                                                                                                                             \
    \n #else \nreturn vec3(0.0);                                                                                                                     \
    \n #endif \n                                                                                                                                     \
  }                                                                                                                                                  \
  float getSaturation(vec3 c) {                                                                                                                      \
    float maxComponent = max(max(c.r, c.g), c.b);                                                                                                    \
    float minComponent = min(min(c.r, c.g), c.b);                                                                                                    \
    float delta = maxComponent - minComponent;                                                                                                       \
    if (maxComponent == minComponent) {                                                                                                              \
      return 0.0;                                                                                                                                    \
    } else {                                                                                                                                         \
      return delta / maxComponent;                                                                                                                   \
    }                                                                                                                                                \
  }                                                                                                                                                  \
  vec3 doSample(const vec3 viewPos, const vec3 viewDir, const vec3 viewNormal, const vec3 worldPos, const float metalness, const float roughness,    \
                const bool isDiffuseSample, const bool isEnvSample, const float NoV, const float NoL, const float NoH, const float LoH,              \
                const float VoH, const vec4 random, inout vec3 l, inout vec3 hitPos, out bool isMissedRay, out vec3 brdf, out float pdf) {           \
    float cosTheta = max(0.0, dot(viewNormal, l));                                                                                                   \
    if (isDiffuseSample) {                                                                                                                           \
      vec3 diffuseBrdf = evalDisneyDiffuse(NoL, NoV, LoH, roughness, metalness);                                                                     \
      pdf = NoL / M_PI;                                                                                                                              \
      brdf = diffuseBrdf;                                                                                                                            \
    } else {                                                                                                                                         \
      vec3 specularBrdf = evalDisneySpecular(roughness, NoH, NoV, NoL);                                                                              \
      pdf = GGXVNDFPdf(NoH, NoV, roughness);                                                                                                         \
      brdf = specularBrdf;                                                                                                                           \
    }                                                                                                                                                \
    brdf *= cosTheta;                                                                                                                                \
    pdf = max(EPSILON, pdf);                                                                                                                         \
    hitPos = viewPos;                                                                                                                                \
    vec2 coords = RayMarch(l, hitPos, random);                                                                                                       \
    bool allowMissedRays = false;                                                                                                                    \
    \n #ifdef missedRays\nallowMissedRays = true;                                                                                                    \
    \n #endif \nisMissedRay = hitPos.x == 10.0e9;                                                                                                    \
    vec3 envMapSample = vec3(0.);                                                                                                                    \
    if (isMissedRay && !allowMissedRays)                                                                                                             \
      return getEnvColor(l, worldPos, roughness, isDiffuseSample, isEnvSample);                                                                      \
    vec4 velocity = textureLod(velocityTexture, coords.xy, 0.0);                                                                                     \
    vec2 reprojectedUv = coords.xy - velocity.xy;                                                                                                    \
    vec3 SSGI;                                                                                                                                       \
    vec3 envColor = getEnvColor(l, worldPos, roughness, isDiffuseSample, isEnvSample);                                                               \
    if (reprojectedUv.x >= 0.0 && reprojectedUv.x <= 1.0 && reprojectedUv.y >= 0.0 && reprojectedUv.y <= 1.0) {                                      \
      vec4 reprojectedGI = textureLod(accumulatedTexture, reprojectedUv, 0.);                                                                        \
      float saturation = getSaturation(mat.diffuse.rgb);                                                                                             \
      reprojectedGI.rgb = mix(reprojectedGI.rgb, vec3(luminance(reprojectedGI.rgb)), (1. - roughness) * saturation * 0.4);                           \
      SSGI = reprojectedGI.rgb;                                                                                                                      \
      float aspect = resolution.x / resolution.y;                                                                                                    \
      float border = 0.15;                                                                                                                           \
      float borderFactor = smoothstep(0.0, border, coords.x) * smoothstep(1.0, 1.0 - border, coords.x) * smoothstep(0.0, border, coords.y) *         \
                           smoothstep(1.0, 1.0 - border, coords.y);                                                                                  \
      borderFactor = sqrt(borderFactor);                                                                                                             \
      SSGI = mix(envColor, SSGI, borderFactor);                                                                                                      \
    } else {                                                                                                                                         \
      return envColor;                                                                                                                               \
    }                                                                                                                                                \
    if (allowMissedRays) {                                                                                                                           \
      float ssgiLum = luminance(SSGI);                                                                                                               \
      float envLum = luminance(envMapSample);                                                                                                        \
      if (envLum > ssgiLum)                                                                                                                          \
        SSGI = envMapSample;                                                                                                                         \
    }                                                                                                                                                \
    return SSGI;                                                                                                                                     \
  }                                                                                                                                                  \
  vec2 RayMarch(inout vec3 dir, inout vec3 hitPos, vec4 random) {                                                                                    \
    float rayHitDepthDifference;                                                                                                                     \
    dir *= rayDistance / float(steps);                                                                                                               \
    vec2 uv;                                                                                                                                         \
    for (int i = 1; i < steps; i++) {                                                                                                                \
      float cs = 1. - exp(-0.25 * pow(float(i) + random.b - 0.5, 2.));                                                                               \
      hitPos += dir * cs;                                                                                                                            \
      uv = viewSpaceToScreenSpace(hitPos);                                                                                                           \
      float unpackedDepth = textureLod(depthTexture, uv, 0.0).r;                                                                                     \
      float z = getViewZ(unpackedDepth);                                                                                                             \
      rayHitDepthDifference = z - hitPos.z;                                                                                                          \
      if (rayHitDepthDifference >= 0.0 && rayHitDepthDifference < thickness) {                                                                       \
        if (refineSteps == 0) {                                                                                                                      \
          return uv;                                                                                                                                 \
        } else {                                                                                                                                     \
          return BinarySearch(dir, hitPos);                                                                                                          \
        }                                                                                                                                            \
      }                                                                                                                                              \
    }                                                                                                                                                \
    hitPos.xyz = vec3(10.0e9);                                                                                                                       \
    return uv;                                                                                                                                       \
  }                                                                                                                                                  \
  vec2 BinarySearch(inout vec3 dir, inout vec3 hitPos) {                                                                                             \
    float rayHitDepthDifference;                                                                                                                     \
    vec2 uv;                                                                                                                                         \
    dir *= 0.5;                                                                                                                                      \
    hitPos -= dir;                                                                                                                                   \
    for (int i = 0; i < refineSteps; i++) {                                                                                                          \
      uv = viewSpaceToScreenSpace(hitPos);                                                                                                           \
      float unpackedDepth = textureLod(depthTexture, uv, 0.0).r;                                                                                     \
      float z = getViewZ(unpackedDepth);                                                                                                             \
      rayHitDepthDifference = z - hitPos.z;                                                                                                          \
      dir *= 0.5;                                                                                                                                    \
      if (rayHitDepthDifference >= 0.0) {                                                                                                            \
        hitPos -= dir;                                                                                                                               \
      } else {                                                                                                                                       \
        hitPos += dir;                                                                                                                               \
      }                                                                                                                                              \
    }                                                                                                                                                \
    uv = viewSpaceToScreenSpace(hitPos);                                                                                                             \
    return uv;                                                                                                                                       \
  }
