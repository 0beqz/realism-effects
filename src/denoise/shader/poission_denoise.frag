varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D inputTexture2;
uniform sampler2D depthTexture;
uniform mat4 projectionMatrix;
uniform mat4 projectionMatrixInverse;
uniform mat4 cameraMatrixWorld;
uniform float radius;
uniform float phi;
uniform float lumaPhi;
uniform float depthPhi;
uniform float normalPhi;
uniform float roughnessPhi;
uniform vec2 resolution;

layout(location = 0) out vec4 gOutput0;
layout(location = 1) out vec4 gOutput1;

#include <common>
#include <gbuffer_packing>

#define luminance(a) min(log(dot(vec3(0.2125, 0.7154, 0.0721), a) + 1.), 0.5);

vec3 getWorldPos(float depth, vec2 coord) {
  float z = depth * 2.0 - 1.0;
  vec4 clipSpacePosition = vec4(coord * 2.0 - 1.0, z, 1.0);
  vec4 viewSpacePosition = projectionMatrixInverse * clipSpacePosition;

  // Perspective division
  vec4 worldSpacePosition = cameraMatrixWorld * viewSpacePosition;
  worldSpacePosition.xyz /= worldSpacePosition.w;
  return worldSpacePosition.xyz;
}

float distToPlane(const vec3 worldPos, const vec3 neighborWorldPos,
                  const vec3 worldNormal) {
  vec3 toCurrent = worldPos - neighborWorldPos;
  float distToPlane = abs(dot(toCurrent, worldNormal));

  return distToPlane;
}

vec2 viewSpaceToScreenSpace(const vec3 position) {
  vec4 projectedCoord = projectionMatrix * vec4(position, 1.0);
  projectedCoord.xy /= projectedCoord.w;
  // [-1, 1] --> [0, 1] (NDC to screen position)
  projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;

  return projectedCoord.xy;
}

void toDenoiseSpace(inout vec3 color) { color = log(color + 1.); }

void toLinearSpace(inout vec3 color) { color = exp(color) - 1.; }

void evaluateNeighbor(const vec4 neighborTexel, inout vec3 denoised,
                      inout float totalWeight, const float wBasic) {
  float w = min(1., wBasic);

  denoised += w * neighborTexel.rgb;
  totalWeight += w;
}

Material centerMat;
float centerDepth;
vec3 centerWorldPos;
float centerLumDiffuse;
float centerLumSpecular;
float centerObliqueness;
float centerDarkness;
float centerRoughnessPow4;
float w, w2;
struct Neighbor {
  vec4 texel;
  float weight;
};

Neighbor getNeighborWeight(vec2 neighborUv, bool isDiffuseGi) {
  float neighborDepth = textureLod(depthTexture, neighborUv, 0.0).r;
  if (neighborDepth == 1.0)
    return Neighbor(vec4(0.), 0.);

  float distanceToCenter = length(vUv - neighborUv) + 1.;
  distanceToCenter = pow(distanceToCenter, 8.) - 1.;

  vec4 neighborDiffuseGi = textureLod(inputTexture, neighborUv, 0.);
  vec4 neighborSpecularGi = textureLod(inputTexture2, neighborUv, 0.);

  toDenoiseSpace(neighborDiffuseGi.rgb);
  toDenoiseSpace(neighborSpecularGi.rgb);

  float neighborLuminance = luminance(neighborDiffuseGi.rgb);
  float neighborLuminance2 = luminance(neighborSpecularGi.rgb);

  Material neighborMat = getMaterial(gBufferTexture, neighborUv);

  vec3 neighborWorldPos = getWorldPos(neighborDepth, neighborUv);

  float normalDiff = 1. - max(dot(centerMat.normal, neighborMat.normal), 0.);
  float depthDiff =
      10. * distToPlane(centerWorldPos, neighborWorldPos, centerMat.normal);

  float roughnessDiff = abs(centerMat.roughness - neighborMat.roughness);

  float lumaDiff = mix(abs(centerLumDiffuse - neighborLuminance), 0., w);
  float lumaDiff2 = mix(abs(centerLumSpecular - neighborLuminance2), 0., w2);

  float wBasic = exp(-normalDiff * normalPhi - depthDiff * depthPhi -
                     roughnessDiff * roughnessPhi);

  if (isDiffuseGi) {
    float wDiff = w * pow(wBasic, phi / w) * exp(-lumaDiff * lumaPhi);
    // wDiff += (centerObliqueness * centerDarkness) * w;

    return Neighbor(neighborDiffuseGi, wDiff);
  } else {
    float wSpec = w2 * pow(wBasic, phi / w2) * exp(-lumaDiff2 * lumaPhi);

    wSpec *= mix(exp(-distanceToCenter * 50. - normalDiff * 100.), 1.,
                 centerRoughnessPow4);

    // wSpec += centerObliqueness * w2;

    return Neighbor(neighborSpecularGi, wSpec);
  }
}

const vec2 poissonDisk[samples] = POISSON_DISK_SAMPLES;

void main() {
  centerDepth = textureLod(depthTexture, vUv, 0.).r;

  if (centerDepth == 1.0) {
    discard;
    return;
  }

  vec4 centerDiffuseGi = textureLod(inputTexture, vUv, 0.0);
  vec4 centerSpecularGi = textureLod(inputTexture2, vUv, 0.0);

  // if (vUv.x < 0.5) {
  //   gOutput0 = centerDiffuseGi;
  //   gOutput1 = centerSpecularGi;

  //   return;
  // }

  toDenoiseSpace(centerDiffuseGi.rgb);
  toDenoiseSpace(centerSpecularGi.rgb);

  centerLumDiffuse = luminance(centerDiffuseGi.rgb);
  centerLumSpecular = luminance(centerSpecularGi.rgb);
  centerDarkness = pow(1. - min(centerLumDiffuse, 1.), 4.);

  // ! todo: increase denoiser aggressiveness by distance
  // ! todo: use separate weights for diffuse and specular

  float totalWeight = 1.;
  float totalWeight2 = 1.;

  vec3 denoisedDiffuse = centerDiffuseGi.rgb * totalWeight;
  vec3 denoisedSpecular = centerSpecularGi.rgb * totalWeight2;

  centerMat = getMaterial(gBufferTexture, vUv);
  centerRoughnessPow4 = centerMat.roughness * centerMat.roughness;
  centerRoughnessPow4 *= centerRoughnessPow4;
  centerWorldPos = getWorldPos(centerDepth, vUv);

  // using cameraMatrixWorld, get how oblique the surface is
  float faceness =
      abs(dot(centerMat.normal, normalize(cameraMatrixWorld[2].xyz)));
  centerObliqueness = (1. - faceness) * 0.01;

  vec4 random = blueNoise();
  float angle = random.r * 2. * PI;
  float s = sin(angle), c = cos(angle);
  mat2 rotationMatrix = mat2(c, -s, s, c);

  float a = centerDiffuseGi.a;
  float a2 = centerSpecularGi.a;

  // the weights w, w2 are used to make the denoiser more aggressive the younger
  // the pixel is
  w = smoothstep(0., 1., 1. / sqrt(a * 0.75 + 1.));
  w2 = smoothstep(0., 1., 1. / sqrt(a2 * 0.75 + 1.));

  // scale the radius depending on the pixel's age
  float r = 1. + random.a * exp(-(a + a2) * 0.001) * radius;

  // vec3 viewNormal = (viewMatrix * vec4(centerMat.normal, 0.0)).xyz;
  // vec3 tangent = normalize(cross(viewNormal, vec3(0.0, 1.0, 0.0)));
  // vec3 bitangent = normalize(cross(viewNormal, tangent));

  for (int i = 0; i < samples; i++) {
    // vec2 offset =
    //     r * rotationMatrix *
    //     (poissonDisk[i].x * tangent.xy + poissonDisk[i].y * bitangent.xy);

    vec2 offset = r * rotationMatrix * poissonDisk[i];

    vec2 neighborUv = vUv + offset;

    Neighbor neighborDiffuse = getNeighborWeight(neighborUv, true);
    Neighbor neighborSpecular = getNeighborWeight(neighborUv, false);

    evaluateNeighbor(neighborDiffuse.texel, denoisedDiffuse, totalWeight,
                     neighborDiffuse.weight);

    evaluateNeighbor(neighborSpecular.texel, denoisedSpecular, totalWeight2,
                     neighborSpecular.weight);
  }

  denoisedDiffuse =
      totalWeight > 0. ? denoisedDiffuse / totalWeight : centerDiffuseGi.rgb;
  denoisedSpecular = totalWeight2 > 0. ? denoisedSpecular / totalWeight2
                                       : centerSpecularGi.rgb;

  toLinearSpace(denoisedDiffuse);
  toLinearSpace(denoisedSpecular);

  // vec3 v = random.x * tangent + random.y * bitangent;
  // v.xy = viewSpaceToScreenSpace(v);

  gOutput0 = vec4(denoisedDiffuse, centerDiffuseGi.a);
  gOutput1 = vec4(denoisedSpecular, centerSpecularGi.a);
}