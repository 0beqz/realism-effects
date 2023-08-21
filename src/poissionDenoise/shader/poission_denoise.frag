varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D inputTexture2;
uniform sampler2D depthTexture;
uniform mat4 projectionMatrixInverse;
uniform mat4 cameraMatrixWorld;
uniform float radius;
uniform float phi;
uniform float lumaPhi;
uniform float depthPhi;
uniform float normalPhi;
uniform float roughnessPhi;
uniform float diffusePhi;
uniform vec2 resolution;

layout(location = 0) out vec4 gOutput0;
layout(location = 1) out vec4 gOutput1;

#include <common>
#include <gbuffer_packing>

#define luminance(a) pow(dot(vec3(0.2125, 0.7154, 0.0721), a), 0.25)

vec3 getWorldPos(float depth, vec2 coord) {
  float z = depth * 2.0 - 1.0;
  vec4 clipSpacePosition = vec4(coord * 2.0 - 1.0, z, 1.0);
  vec4 viewSpacePosition = projectionMatrixInverse * clipSpacePosition;

  // Perspective division
  vec4 worldSpacePosition = cameraMatrixWorld * viewSpacePosition;
  worldSpacePosition.xyz /= worldSpacePosition.w;
  return worldSpacePosition.xyz;
}

float getCurvature(vec3 n, float depth) {
  vec3 dx = dFdx(n);
  vec3 dy = dFdy(n);
  vec3 xneg = n - dx;
  vec3 xpos = n + dx;
  vec3 yneg = n - dy;
  vec3 ypos = n + dy;
  float curvature = (cross(xneg, xpos).y - cross(yneg, ypos).x) * 4.0 / depth;

  return curvature;
}

float distToPlane(const vec3 worldPos, const vec3 neighborWorldPos,
                  const vec3 worldNormal) {
  vec3 toCurrent = worldPos - neighborWorldPos;
  float distToPlane = abs(dot(toCurrent, worldNormal));

  return distToPlane;
}

void toDenoiseSpace(inout vec3 color) { color = log(color + 1.); }

void toLinearSpace(inout vec3 color) { color = exp(color) - 1.; }

float getLuminanceWeight(float luminance, float a) {
  return mix(1. / (luminance + 0.01), 1., 1. / pow(a + 1., 4.));
}

void evaluateNeighbor(const vec4 neighborTexel, const float neighborLuminance,
                      inout vec3 denoised, inout float totalWeight,
                      const float basicWeight) {
  float w = min(1., basicWeight);
  w *= getLuminanceWeight(neighborLuminance, neighborTexel.a);

  denoised += w * neighborTexel.rgb;
  totalWeight += w;
}

const vec2 poissonDisk[samples] = POISSON_DISK_SAMPLES;

void main() {
  vec4 depthTexel = textureLod(depthTexture, vUv, 0.);

  if (depthTexel.r == 1.0) {
    discard;
    return;
  }

  vec4 texel = textureLod(inputTexture, vUv, 0.0);
  vec4 texel2 = textureLod(inputTexture2, vUv, 0.0);

  toDenoiseSpace(texel.rgb);
  toDenoiseSpace(texel2.rgb);

  float lum = luminance(texel.rgb);
  float lum2 = luminance(texel2.rgb);
  float darkness = pow(1. - min(lum, 1.), 4.);

  // ! todo: increase denoiser aggressiveness by distance
  // ! todo: use separate weights for diffuse and specular

  float totalWeight = getLuminanceWeight(lum, texel.a);
  float totalWeight2 = getLuminanceWeight(lum2, texel2.a);

  vec3 denoised = texel.rgb * totalWeight;
  vec3 denoised2 = texel2.rgb * totalWeight2;

  Material mat = getMaterial(gBuffersTexture, vUv);

  float depth = depthTexel.x;
  vec3 worldPos = getWorldPos(depth, vUv);

  // using cameraMatrixWorld, get how oblique the surface is
  float faceness = abs(dot(mat.normal, normalize(cameraMatrixWorld[2].xyz)));
  float obl = 1. - faceness;

  vec4 random = blueNoise();
  float angle = random.r * 2. * PI;
  float s = sin(angle), c = cos(angle);
  mat2 rotationMatrix = mat2(c, -s, s, c);

  float specularWeight = mat.roughness * mat.roughness > 0.15
                             ? 1.
                             : sqrt(mat.roughness * mat.roughness / 0.15);
  // specularWeight = max(0.05, specularWeight);

  float a = texel.a;
  float a2 = texel2.a;

  float doDenoiseFlag = float(a < 256.);
  float doDenoiseFlag2 = float(a2 < 256.);

  float w = smoothstep(0., 1., 1. / sqrt(a * 0.75 + 1.));
  float w2 = smoothstep(0., 1., 1. / sqrt(a2 * 0.75 + 1.));

  float r = 2. + random.a * (radius - 2.);

  for (int i = 0; i < samples; i++) {
    vec2 offset = r * rotationMatrix * poissonDisk[i];
    vec2 neighborUv = vUv + offset;

    vec4 neighborTexel = textureLod(inputTexture, neighborUv, 0.);
    vec4 neighborTexel2 = textureLod(inputTexture2, neighborUv, 0.);

    toDenoiseSpace(neighborTexel.rgb);
    toDenoiseSpace(neighborTexel2.rgb);

    float neighborLuminance = luminance(neighborTexel.rgb);
    float neighborLuminance2 = luminance(neighborTexel2.rgb);

    Material neighborMat = getMaterial(gBuffersTexture, neighborUv);

    float neighborDepth = textureLod(depthTexture, neighborUv, 0.0).x;
    vec3 neighborWorldPos = getWorldPos(neighborDepth, neighborUv);

    float normalDiff = 1. - max(dot(mat.normal, neighborMat.normal), 0.);
    float depthDiff = 10. * distToPlane(worldPos, neighborWorldPos, mat.normal);

    float roughnessDiff = abs(mat.roughness - neighborMat.roughness);
    float diffuseDiff = length(neighborMat.diffuse.rgb - mat.diffuse.rgb);

    float lumaDiff = mix(abs(lum - neighborLuminance), 0., w);
    float lumaDiff2 = mix(abs(lum2 - neighborLuminance2), 0., w2);

    float basicWeight =
        exp(-normalDiff * normalPhi - depthDiff * depthPhi -
            roughnessDiff * roughnessPhi - diffuseDiff * diffusePhi);

    float similarity = w * pow(basicWeight, phi / w) * exp(-lumaDiff * lumaPhi);
    float similarity2 =
        w2 * pow(basicWeight, phi / w2) * exp(-lumaDiff2 * lumaPhi);

    similarity += (obl * 0.01 + darkness * 0.01) * w;
    similarity2 += (obl * 0.01) * w2;

    // similarity = mix(similarity, 1., p);
    similarity2 *= specularWeight;

    float validNeighborWeight = doDenoiseFlag * float(neighborDepth != 1.0);
    float validNeighborWeight2 = doDenoiseFlag2 * float(neighborDepth != 1.0);

    evaluateNeighbor(neighborTexel, neighborLuminance, denoised, totalWeight,
                     similarity * validNeighborWeight);

    evaluateNeighbor(neighborTexel2, neighborLuminance2, denoised2,
                     totalWeight2, similarity2 * validNeighborWeight2);
  }

  denoised = totalWeight > 0. ? denoised / totalWeight : texel.rgb;
  denoised2 = totalWeight2 > 0. ? denoised2 / totalWeight2 : texel2.rgb;

  toLinearSpace(denoised);
  toLinearSpace(denoised2);

#define FINAL_OUTPUT

  // denoised = vec3(r < 2. ? 1. : 0.);
  // denoised = vec3(texel.a / 100.);

  gOutput0 = vec4(denoised, texel.a);
  gOutput1 = vec4(denoised2, texel2.a);
}