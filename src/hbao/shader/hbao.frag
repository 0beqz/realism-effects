varying vec2 vUv;

uniform highp sampler2D depthTexture;

uniform mat4 projectionViewMatrix;
uniform int frame;

uniform vec2 resolution;

uniform float aoDistance;
uniform float distancePower;
uniform float bias;
uniform float thickness;

#include <packing>
// HBAO Utils
#include <hbao_utils>

const vec3 samples[] = vec3[](vec3(0.176085, 0.000000, 0.984375), vec3(-0.223111, 0.204388, 0.953125), vec3(0.033876, -0.386004, 0.921875),
                              vec3(0.276681, 0.360881, 0.890625), vec3(-0.503529, -0.089067, 0.859375), vec3(0.472962, -0.300859, 0.828125),
                              vec3(-0.156838, 0.583431, 0.796875), vec3(-0.296496, -0.570884, 0.765625), vec3(0.637559, 0.232835, 0.734375),
                              vec3(-0.657271, 0.271312, 0.703125), vec3(0.313928, -0.670845, 0.671875), vec3(0.229806, 0.732659, 0.640625),
                              vec3(-0.686011, -0.397557, 0.609375), vec3(0.796917, -0.175200, 0.578125), vec3(-0.481507, 0.684894, 0.546875),
                              vec3(-0.110110, -0.849710, 0.515625), vec3(0.668961, 0.563801, 0.484375), vec3(-0.890686, 0.036833, 0.453125),
                              vec3(0.642663, -0.639536, 0.421875), vec3(-0.042522, 0.919567, 0.390625), vec3(-0.597905, -0.716491, 0.359375),
                              vec3(0.936198, 0.125964, 0.328125), vec3(-0.783851, 0.545383, 0.296875), vec3(0.211597, -0.940569, 0.265625),
                              vec3(0.483333, 0.843480, 0.234375), vec3(-0.932832, -0.297599, 0.203125), vec3(0.894282, -0.413181, 0.171875),
                              vec3(-0.382225, 0.913307, 0.140625), vec3(-0.336422, -0.935338, 0.109375), vec3(0.882484, 0.463809, 0.078125),
                              vec3(-0.965907, 0.254610, 0.046875), vec3(0.540772, -0.841024, 0.015625), vec3(0.169355, 0.985431, -0.015625),
                              vec3(-0.789754, -0.611630, -0.046875), vec3(0.993540, -0.082313, -0.078125), vec3(-0.675005, 0.729661, -0.109375),
                              vec3(0.004830, -0.990051, -0.140625), vec3(0.661887, 0.729633, -0.171875), vec3(-0.974974, -0.090360, -0.203125),
                              vec3(0.774372, -0.587721, -0.234375), vec3(-0.172554, 0.948509, -0.265625), vec3(-0.508594, -0.808206, -0.296875),
                              vec3(0.911040, 0.249678, -0.328125), vec3(-0.830249, 0.426070, -0.359375), vec3(0.319999, -0.863141, -0.390625),
                              vec3(0.341847, 0.839739, -0.421875), vec3(-0.805561, -0.381771, -0.453125), vec3(0.836028, -0.257756, -0.484375),
                              vec3(-0.433224, 0.739221, -0.515625), vec3(-0.175775, -0.818554, -0.546875), vec3(0.665199, 0.472526, -0.578125),
                              vec3(-0.786795, 0.098057, -0.609375), vec3(0.497699, -0.584718, -0.640625), vec3(0.026992, 0.740173, -0.671875),
                              vec3(-0.499107, -0.506465, -0.703125), vec3(0.677858, 0.034659, -0.734375), vec3(-0.495910, 0.409746, -0.765625),
                              vec3(0.083481, -0.598349, -0.796875), vec3(0.317896, 0.461683, -0.828125), vec3(-0.498324, -0.114663, -0.859375),
                              vec3(0.395651, -0.224160, -0.890625), vec3(-0.119570, 0.368578, -0.921875), vec3(-0.125566, -0.275292, -0.953125),
                              vec3(0.162100, 0.068771, -0.984375));

float getOcclusion(const vec3 cameraPosition, const vec3 worldPos, const vec3 worldNormal, const float depth, const int seed,
                   inout float totalWeight) {
  vec4 blueNoise = blueNoise(vUv, seed);

  vec3 sampleWorldDir = cosineSampleHemisphere(worldNormal, blueNoise.rg);
  // sampleWorldDir = samples[seed % 64];

  vec3 sampleWorldPos = worldPos + aoDistance * pow(blueNoise.b, distancePower + 1.0) * sampleWorldDir;

  // Project the sample position to screen space
  vec4 sampleUv = projectionViewMatrix * vec4(sampleWorldPos, 1.);
  sampleUv.xy /= sampleUv.w;
  sampleUv.xy = sampleUv.xy * 0.5 + 0.5;

  // Get the depth of the sample position
  float sampleDepth = textureLod(depthTexture, sampleUv.xy, 0.0).r;

  // Compute the horizon line
  float deltaDepth = depth - sampleDepth;

  // distance based bias
  float d = distance(sampleWorldPos, cameraPosition);
  deltaDepth *= 0.001 * d * d;

  float th = thickness * 0.01;

  float theta = dot(worldNormal, sampleWorldDir);
  totalWeight += theta;

  if (deltaDepth < th) {
    float horizon = sampleDepth + deltaDepth * bias * 1000.;

    float occlusion = max(0.0, horizon - depth) * theta;

    float m = max(0., 1. - deltaDepth / th);
    occlusion = 10. * occlusion * m / d;

    occlusion = pow(occlusion, 0.1);
    return occlusion;
  }

  return 0.;
}

void main() {
  float depth = textureLod(depthTexture, vUv, 0.0).r;

  // filter out background
  if (depth == 1.0) {
    discard;
    return;
  }

  vec4 cameraPosition = cameraMatrixWorld * vec4(0.0, 0.0, 0.0, 1.0);

  vec3 worldPos = getWorldPos(depth, vUv);
  vec3 worldNormal = getWorldNormal(vUv);

  float ao = 0.0, totalWeight = 0.0;

  for (int i = 0; i < spp; i++) {
    int seed = blueNoiseIndex * spp + i;
    float occlusion = getOcclusion(cameraPosition.xyz, worldPos, worldNormal, depth, seed, totalWeight);
    ao += occlusion;
  }

  if (totalWeight > 0.)
    ao /= totalWeight;

  // clamp ao to [0, 1]
  ao = clamp(1. - ao, 0., 1.);

  gl_FragColor = vec4(worldNormal, ao);
}