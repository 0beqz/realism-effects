varying vec2 vUv;

uniform sampler2D accumulatedTexture;
uniform sampler2D depthTexture;
uniform sampler2D velocityTexture;
uniform sampler2D directLightTexture;

uniform mat4 projectionMatrix;
uniform mat4 projectionMatrixInverse;
uniform mat4 cameraMatrixWorld;
uniform float cameraNear;
uniform float cameraFar;

uniform float maxEnvMapMipLevel;

uniform float rayDistance;
uniform float thickness;
uniform float envBlur;

uniform vec2 resolution;

struct EquirectHdrInfo {
  sampler2D marginalWeights;
  sampler2D conditionalWeights;
  sampler2D map;
  vec2 size;
  float totalSumWhole;
  float totalSumDecimal;
};

uniform EquirectHdrInfo envMapInfo;

#define INVALID_RAY_COORDS vec2(-1.0);
#define EPSILON 0.00001
#define ONE_MINUS_EPSILON 1.0 - EPSILON

float nearMinusFar;
float nearMulFar;
float farMinusNear;
vec2 invTexSize;

#include <packing>

// helper functions
#include <gbuffer_packing>
#include <ssgi_utils>

vec2 RayMarch(inout vec3 dir, inout vec3 hitPos, vec4 random);
vec2 BinarySearch(inout vec3 dir, inout vec3 hitPos);

struct RayTracingInfo {
  float NoV;            // dot(n, v)
  float NoL;            // dot(n, l)
  float NoH;            // dot(n, h)
  float LoH;            // dot(l, h)
  float VoH;            // dot(v, h)
  bool isDiffuseSample; // whether the sample is diffuse or specular
  bool isEnvMisSample;  // whether the sample is importance sampled from the env
                        // map
};

struct RayTracingResult {
  vec3 gi;          // computed global illumination for a sample
  vec3 l;           // sample world space direction
  vec3 hitPos;      // hit position
  bool isMissedRay; // whether the ray missed the scene
  vec3 brdf;        // brdf value
  float pdf;        // pdf value
};

// !todo: refactor functions
// RayTracingResult doSample(const vec3 viewPos, const vec3 viewDir, const vec3
// viewNormal, const vec3 worldPosition, const vec4 random, Material mat,
// RayTracingInfo info);

vec3 doSample(const vec3 viewPos, const vec3 viewDir, const vec3 viewNormal,
              const vec3 worldPosition, const float metalness,
              const float roughness, const bool isDiffuseSample,
              const bool isEnvMisSample, const float NoV, const float NoL,
              const float NoH, const float LoH, const float VoH,
              const vec4 random, inout vec3 l, inout vec3 hitPos,
              out bool isMissedRay, out vec3 brdf, out float pdf);

void calculateAngles(inout vec3 h, inout vec3 l, inout vec3 v, inout vec3 n,
                     inout float NoL, inout float NoH, inout float LoH,
                     inout float VoH) {
  h = normalize(v + l); // half vector

  NoL = clamp(dot(n, l), EPSILON, ONE_MINUS_EPSILON);
  NoH = clamp(dot(n, h), EPSILON, ONE_MINUS_EPSILON);
  LoH = clamp(dot(l, h), EPSILON, ONE_MINUS_EPSILON);
  VoH = clamp(dot(v, h), EPSILON, ONE_MINUS_EPSILON);
}

void main() {
  float unpackedDepth = textureLod(depthTexture, vUv, 0.0).r;

  // filter out background
  if (unpackedDepth == 1.0) {
    discard;
    return;
  }

  Material mat = getMaterial(gBufferTexture, vUv);

  invTexSize = 1. / resolution;

  mat.roughness = clamp(mat.roughness * mat.roughness, 0.000001, 1.0);

  // pre-calculated variables for the "fastGetViewZ" function
  // nearMinusFar = cameraNear - cameraFar;
  // nearMulFar = cameraNear * cameraFar;
  // farMinusNear = cameraFar - cameraNear;

  // view-space depth
  float depth = getViewZ(unpackedDepth);

  // view-space position of the current texel
  vec3 viewPos = getViewPosition(depth);

  vec3 viewDir = normalize(viewPos);
  vec3 worldNormal = mat.normal;

  vec3 viewNormal = normalize((vec4(worldNormal, 0.) * cameraMatrixWorld).xyz);

  vec3 worldPos = vec4(vec4(viewPos, 1.) * viewMatrix).xyz;

  vec3 n = viewNormal; // view-space normal
  vec3 v = -viewDir;   // incoming vector
  float NoV = max(EPSILON, dot(n, v));

  // convert view dir to world-space
  vec3 V = (vec4(v, 0.) * viewMatrix).xyz;
  vec3 N = worldNormal;

  vec4 random;
  vec3 H, l, h, F, T, B, envMisDir, gi;
  vec3 diffuseGI, specularGI, brdf, hitPos, specularHitPos;

  Onb(N, T, B);

  V = ToLocal(T, B, N, V);

  // fresnel f0
  vec3 f0 = mix(vec3(0.04), mat.diffuse.rgb, mat.metalness);

  float NoL, NoH, LoH, VoH, diffW, specW, invW, pdf, envPdf, diffuseSamples,
      specularSamples, envMisProbability, envMisMultiplier;
  bool isDiffuseSample, isEnvMisSample, isMissedRay;

  random = blueNoise();
  // Disney BRDF and sampling source: https://www.shadertoy.com/view/cll3R4
  // calculate GGX reflection ray
  H = SampleGGXVNDF(V, mat.roughness, mat.roughness, random.r, random.g);
  if (H.z < 0.0)
    H = -H;

  l = normalize(reflect(-V, H));
  l = ToWorld(T, B, N, l);

  // convert reflected vector back to view-space
  l = (vec4(l, 0.) * cameraMatrixWorld).xyz;
  l = normalize(l);

  calculateAngles(h, l, v, n, NoL, NoH, LoH, VoH);

#if !defined(diffuseOnly) && !defined(specularOnly)
  // fresnel
  F = F_Schlick(f0, VoH);

  // diffuse and specular weight
  diffW = (1. - mat.metalness) * luminance(mat.diffuse.rgb);
  specW = luminance(F);

  diffW = max(diffW, EPSILON);
  specW = max(specW, EPSILON);

  invW = 1. / (diffW + specW);

  // relative weights used for choosing either a diffuse or specular ray
  diffW *= invW;

  // if diffuse lighting should be sampled
  isDiffuseSample = random.b < diffW;
#else
#ifdef diffuseOnly
  isDiffuseSample = true;
#else
  isDiffuseSample = false;
#endif
#endif
  envMisDir = vec3(0.0);

#ifdef importanceSampling
  envPdf = sampleEquirectProbability(envMapInfo, random.rg, envMisDir);
  envMisDir = normalize((vec4(envMisDir, 0.) * cameraMatrixWorld).xyz);

  envMisProbability = 0.5 + dot(envMisDir, viewNormal) * 0.5;
  envMisProbability *= sqrt(mat.roughness);
  isEnvMisSample = random.a < envMisProbability;

  envMisMultiplier = 1. / (1. - envMisProbability);

  if (isEnvMisSample) {
    envPdf /= 1. - envMisProbability;

    l = envMisDir;
    calculateAngles(h, l, v, n, NoL, NoH, LoH, VoH);
  } else {
    envPdf = 0.0001;
  }
#else
  envPdf = 0.0;
  envMisMultiplier = 1.;
#endif

  vec3 diffuseRay = isEnvMisSample
                        ? envMisDir
                        : cosineSampleHemisphere(viewNormal, random.rg);
  vec3 specularRay = (isEnvMisSample && mat.roughness >= 0.025) ? envMisDir : l;

  if (isDiffuseSample) {
    l = diffuseRay;

    calculateAngles(h, l, v, n, NoL, NoH, LoH, VoH);

    gi = doSample(viewPos, viewDir, viewNormal, worldPos, mat.metalness,
                  mat.roughness, isDiffuseSample, isEnvMisSample, NoV, NoL, NoH,
                  LoH, VoH, random, l, hitPos, isMissedRay, brdf, pdf);

    gi *= brdf;

    if (isEnvMisSample) {
      gi *= misHeuristic(envPdf, pdf);
      gi /= envPdf;
    } else {
      gi /= pdf;
      gi *= envMisMultiplier;
    }

    diffuseSamples++;

    diffuseGI = mix(diffuseGI, gi, 1. / diffuseSamples);
  }

  // specular
  l = specularRay;

  if (isEnvMisSample) {
    calculateAngles(h, l, v, n, NoL, NoH, LoH, VoH);
  }

  gi = doSample(viewPos, viewDir, viewNormal, worldPos, mat.metalness,
                mat.roughness, isDiffuseSample, isEnvMisSample, NoV, NoL, NoH,
                LoH, VoH, random, l, hitPos, isMissedRay, brdf, pdf);

  gi *= brdf;

  if (isEnvMisSample) {
    gi *= misHeuristic(envPdf, pdf);
    gi /= envPdf;
  } else {
    gi /= pdf;
    gi *= envMisMultiplier;
  }

  specularHitPos = hitPos;

  specularSamples++;

  specularGI = mix(specularGI, gi, 1. / specularSamples);

  mat.roughness = sqrt(mat.roughness);

#ifdef useDirectLight
  vec3 directLight = textureLod(directLightTexture, vUv, 0.).rgb;

  diffuseGI += directLight;
  specularGI += directLight;
#endif

  vec4 gDiffuse, gSpecular;

#ifndef specularOnly
  if (diffuseSamples == 0.0)
    diffuseGI = vec3(-1.0);
  gDiffuse = vec4(diffuseGI, mat.roughness);
#endif

#ifndef diffuseOnly
  // calculate world-space ray length used for reprojecting hit points instead
  // of screen-space pixels in the temporal reproject pass
  float rayLength = 0.0;

  vec4 hitPosWS;

  if (isMissedRay) {
    rayLength = 10.0e4;
  } else {
    // convert hitPos from view- to world-space
    hitPosWS = cameraMatrixWorld * vec4(specularHitPos, 1.0);

    // get the camera position in world-space from the camera matrix
    vec3 cameraPosWS = cameraMatrixWorld[3].xyz;

    rayLength = distance(cameraPosWS, hitPosWS.xyz);
  }

  // if (specularSamples == 0.0) {
  //   specularGI = vec3(-1.0);
  //   rayLength = 0.;
  // }

  gSpecular = vec4(specularGI, rayLength);
#endif

  gl_FragColor = packTwoVec4(gDiffuse, gSpecular);
}

vec3 doSample(const vec3 viewPos, const vec3 viewDir, const vec3 viewNormal,
              const vec3 worldPosition, const float metalness,
              const float roughness, const bool isDiffuseSample,
              const bool isEnvMisSample, const float NoV, const float NoL,
              const float NoH, const float LoH, const float VoH,
              const vec4 random, inout vec3 l, inout vec3 hitPos,
              out bool isMissedRay, out vec3 brdf, out float pdf) {
  float cosTheta = max(0.0, dot(viewNormal, l));

  if (isDiffuseSample) {
    vec3 diffuseBrdf =
        vec3(evalDisneyDiffuse(NoL, NoV, LoH, roughness, metalness));
    pdf = NoL / M_PI;
    pdf = max(EPSILON, pdf);

    brdf = diffuseBrdf;
  } else {
    vec3 specularBrdf = evalDisneySpecular(roughness, NoH, NoV, NoL);
    pdf = GGXVNDFPdf(NoH, NoV, roughness);
    pdf = max(EPSILON, pdf);

    brdf = specularBrdf;
  }

  brdf *= cosTheta;

  hitPos = viewPos;

#if steps == 0
  hitPos += l;

  vec2 coords = viewSpaceToScreenSpace(hitPos);
#else
  vec2 coords = RayMarch(l, hitPos, random);
#endif

  bool allowMissedRays = false;
#ifdef missedRays
  allowMissedRays = true;
#endif

  isMissedRay = coords.x == -1.0;

  vec3 envMapSample = vec3(0.);

  // inisEnvMisSample ray, use environment lighting as fallback
  if (isMissedRay || allowMissedRays) {
#ifdef USE_ENVMAP
    // world-space reflected ray
    vec3 reflectedWS = normalize((vec4(l, 0.) * viewMatrix).xyz);

#ifdef BOX_PROJECTED_ENV_MAP
    reflectedWS = parallaxCorrectNormal(reflectedWS.xyz, envMapSize,
                                        envMapPosition, worldPosition);
    reflectedWS = normalize(reflectedWS.xyz);
#endif

    float mip = envBlur * maxEnvMapMipLevel;

    if (!isDiffuseSample && roughness < 0.15)
      mip *= roughness / 0.15;

    envMapSample = sampleEquirectEnvMapColor(reflectedWS, envMapInfo.map, mip);

    float maxEnvLum = isEnvMisSample ? 100.0 : 50.0;

    if (maxEnvLum != 0.0) {
      // we won't deal with calculating direct sun light from the env map as it
      // is too noisy
      float envLum = luminance(envMapSample);

      if (envLum > maxEnvLum) {
        envMapSample *= maxEnvLum / envLum;
      }
    }

    return envMapSample;
#else
    // if we don't have an environment map, just return black
    return vec3(0.0);
#endif
  }

  // reproject the coords from the last frame
  vec4 velocity = textureLod(velocityTexture, coords.xy, 0.0);

  vec2 reprojectedUv = coords.xy - velocity.xy;

  vec3 SSGI;

  // check if the reprojected coordinates are within the screen
  if (reprojectedUv.x >= 0.0 && reprojectedUv.x <= 1.0 &&
      reprojectedUv.y >= 0.0 && reprojectedUv.y <= 1.0) {
    vec4 reprojectedGI = textureLod(accumulatedTexture, reprojectedUv, 0.);

    SSGI = reprojectedGI.rgb;
  }

  if (allowMissedRays) {
    float ssgiLum = luminance(SSGI);
    float envLum = luminance(envMapSample);

    if (envLum > ssgiLum)
      SSGI = envMapSample;
  }

  return SSGI;
}

vec2 RayMarch(inout vec3 dir, inout vec3 hitPos, vec4 random) {
  float rayHitDepthDifference;

  dir *= rayDistance / float(steps);

  hitPos += dir * random.b;

  vec2 uv;

  for (int i = 1; i < steps; i++) {
    // use slower increments for the first few steps to sharpen contact shadows
    float m = exp(pow(float(i) / 4.0, 0.05)) - 2.0;
    hitPos += dir * min(m, 1.);

    if (hitPos.z > 0.0)
      return INVALID_RAY_COORDS;

    uv = viewSpaceToScreenSpace(hitPos);

    float unpackedDepth = textureLod(depthTexture, uv, 0.0).r;
    float depth = getViewZ(unpackedDepth);

    rayHitDepthDifference = depth - hitPos.z;

    if (rayHitDepthDifference >= 0.0 && rayHitDepthDifference < thickness) {
#if refineSteps == 0
      return uv;
#else
      return BinarySearch(dir, hitPos);
#endif
    }
  }

#ifndef missedRays
  return INVALID_RAY_COORDS;
#endif

  return uv;
}

vec2 BinarySearch(inout vec3 dir, inout vec3 hitPos) {
  float rayHitDepthDifference;
  vec2 uv;

  dir *= 0.5;
  hitPos -= dir;

  for (int i = 0; i < refineSteps; i++) {
    uv = viewSpaceToScreenSpace(hitPos);

    float unpackedDepth = unpackRGBAToDepth(textureLod(depthTexture, uv, 0.0));
    float depth = getViewZ(unpackedDepth);

    rayHitDepthDifference = depth - hitPos.z;

    dir *= 0.5;
    hitPos += rayHitDepthDifference > 0.0 ? -dir : dir;
  }

  uv = viewSpaceToScreenSpace(hitPos);

  return uv;
}
