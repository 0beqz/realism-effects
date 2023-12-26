varying vec2 vUv;

uniform highp sampler2D inputTexture;
uniform highp sampler2D velocityTexture;

uniform highp sampler2D depthTexture;
uniform highp sampler2D lastVelocityTexture;

uniform float maxBlend;
uniform float neighborhoodClampIntensity;
uniform bool fullAccumulate;
uniform vec2 invTexSize;
uniform float cameraNear;
uniform float cameraFar;

uniform mat4 projectionMatrix;
uniform mat4 projectionMatrixInverse;
uniform mat4 cameraMatrixWorld;
uniform vec3 cameraPos;
uniform vec3 prevCameraPos;
uniform mat4 prevViewMatrix;
uniform mat4 prevCameraMatrixWorld;
uniform mat4 prevProjectionMatrix;
uniform mat4 prevProjectionMatrixInverse;

uniform float keepData;

#define EPSILON 0.00001

#define DIFFUSE_SPECULAR 0
#define DIFFUSE 1
#define SPECULAR 2

#include <gbuffer_packing>
#include <packing>
#include <reproject>

vec3 reprojectedUvDiffuse = vec3(-1.0), reprojectedUvSpecular = vec3(-1.0);

// this function does the final accumulation of the input texture and the accumulated texture
// it computes a final blend value, taking into account factors such as movement and confidence
void accumulate(inout vec4 outputColor, inout vec4 inp, inout vec4 acc, inout float roughness, inout float moveFactor, bool doReprojectSpecular) {
  vec3 reprojectedUvConfidence = doReprojectSpecular ? reprojectedUvSpecular : reprojectedUvDiffuse;

  vec2 reprojectedUv = reprojectedUvConfidence.xy;
  float confidence = reprojectedUvConfidence.z;
  confidence = pow(confidence, confidencePower);

  float accumBlend = 1. - 1. / (acc.a + 1.0);
  accumBlend = mix(0., accumBlend, confidence);

  float maxValue = (fullAccumulate ? 1. : maxBlend) * keepData; // keepData is a flag that is either 1 or 0 when we call reset()
  // maxValue *= 0.;

#if inputType != DIFFUSE
  const float roughnessMaximum = 0.1;

  if (doReprojectSpecular && roughness >= 0.0 && roughness < roughnessMaximum) {
    float maxRoughnessValue = mix(0., maxValue, roughness / roughnessMaximum);
    maxValue = mix(maxValue, maxRoughnessValue, min(100. * moveFactor, 1.));
  }
#endif

  float temporalReprojectMix = min(accumBlend, maxValue);

  // calculate the alpha from temporalReprojectMix
  acc.a = 1. / (1. - temporalReprojectMix) - 1.;
  acc.a = min(65536., acc.a);
  // acc.a = 10.;

  outputColor.rgb = mix(inp.rgb, acc.rgb, temporalReprojectMix);
  outputColor.a = acc.a;
  undoColorTransform(outputColor.rgb);

  // outputColor.rgb = vec3(confidence);
  // if (length(fwidth(worldNormal)) < 0.02) {
  //   outputColor.rgb = vec3(0., 1., 0.);
  // }
}

// this function reprojects the input texture to the current frame
// it calculates a confidence value for the reprojection by which the input texture is blended with the accumulated texture
void reproject(inout vec4 inp, inout vec4 acc, sampler2D accumulatedTexture, inout bool wasSampled, bool doNeighborhoodClamp,
               bool doReprojectSpecular) {
  // Get the reprojected UV coordinate.
  vec3 uvc = doReprojectSpecular ? reprojectedUvSpecular : reprojectedUvDiffuse;
  vec2 uv = uvc.xy;

  // Sample the accumulated texture.
  acc = sampleReprojectedTexture(accumulatedTexture, uv);
  transformColor(acc.rgb);

  // If we haven't sampled before, simply use the sample.
  if (!wasSampled) {
    inp.rgb = acc.rgb;
    return;
  }

  // Add one more frame.
  acc.a++;

  // Apply neighborhood clamping, if enabled.
  vec3 clampedColor = acc.rgb;

  int clampRadius = doReprojectSpecular && roughness < 0.25 ? 1 : 2;
  clampNeighborhood(inputTexture, clampedColor, inp.rgb, clampRadius, doReprojectSpecular);
  float r = doReprojectSpecular ? roughness : 1.0;

  float clampAggressiveness = min(1., uvc.z * r);

  float clampIntensity = mix(0., min(1., moveFactor * 50. + neighborhoodClampIntensity), clampAggressiveness);

  vec3 newColor = mix(acc.rgb, clampedColor, clampIntensity);

  // check how much the color has changed
  float colorDiff = min(length(newColor - acc.rgb), 1.);
  // moveFactor = colorDiff;

  acc.a *= 1. - colorDiff;

  acc.rgb = newColor;
}

void preprocessInput(inout highp vec4 texel, inout bool sampledThisFrame) {
  sampledThisFrame = texel.r >= 0.;
  texel.rgb = max(texel.rgb, vec3(0.));
  transformColor(texel.rgb);
}

void getTexels(inout highp vec4 inputTexel[textureCount], inout bool sampledThisFrame[textureCount]) {
#if inputType == DIFFUSE_SPECULAR
  // not defining the sampled texture as a variable but passing it to the function directly causes platform-specific errors
  // on Samsung Galaxy S21, for example the textures seems to be sampled as HalfFloats instead of Floats (it gives the same errorneous results as
  // packing the 2 textures in a single HalfFloat RGBA texture). This is probably a bug in the driver. The diffuse texture appears blueish in that
  // case
  highp vec4 tex = textureLod(inputTexture, vUv, 0.);
  unpackTwoVec4(tex, inputTexel[0], inputTexel[1]);

  preprocessInput(inputTexel[0], sampledThisFrame[0]);
  preprocessInput(inputTexel[1], sampledThisFrame[1]);
#else
  inputTexel[0] = textureLod(inputTexture, vUv, 0.0);
  preprocessInput(inputTexel[0], sampledThisFrame[0]);
#endif
}

void computeGVariables(vec2 dilatedUv, float depth) {
  worldPos = screenSpaceToWorldSpace(dilatedUv, depth, cameraMatrixWorld, projectionMatrixInverse);
  vec3 viewPos = (viewMatrix * vec4(worldPos, 1.0)).xyz;
  viewDir = normalize(viewPos);
  vec3 viewNormal = (vec4(worldNormal, 0.0) * viewMatrix).xyz;
  viewAngle = dot(-viewDir, viewNormal);
}

void computeReprojectedUv(float depth, vec3 worldPos, vec3 worldNormal) {
  reprojectedUvDiffuse = getReprojectedUV(false, depth, worldPos, worldNormal);

#if inputType == DIFFUSE_SPECULAR || inputType == SPECULAR
  reprojectedUvSpecular = getReprojectedUV(true, depth, worldPos, worldNormal);

  if (reprojectedUvSpecular.x == -1.0) {
    reprojectedUvSpecular = reprojectedUvDiffuse;
  }
#endif
}

void getRoughnessRayLength(inout highp vec4 inputTexel[textureCount]) {
#if inputType == DIFFUSE_SPECULAR
  rayLength = inputTexel[1].a;
  roughness = clamp(inputTexel[0].a, 0., 1.);
#elif inputType == SPECULAR
  vec2 data = unpackHalf2x16(floatBitsToUint(inputTexel[0].a));
  rayLength = data.r;
  roughness = clamp(data.g, 0., 1.);
#endif
}

void main() {
  vec2 dilatedUv = vUv;
  getVelocityNormalDepth(dilatedUv, velocity, worldNormal, depth);

  highp vec4 inputTexel[textureCount], accumulatedTexel[textureCount];
  bool textureSampledThisFrame[textureCount];

  getTexels(inputTexel, textureSampledThisFrame);

// ! todo: find better solution
#if inputType != DIFFUSE
  if (depth == 1.0 && fwidth(depth) == 0.0) {
    discard;
    return;
  }
#endif

  curvature = getCurvature(worldNormal);

  computeGVariables(dilatedUv, depth);
  getRoughnessRayLength(inputTexel);
  computeReprojectedUv(depth, worldPos, worldNormal);

  moveFactor = min(dot(velocity, velocity) * 10000., 1.);

#pragma unroll_loop_start
  for (int i = 0; i < textureCount; i++) {
    reproject(inputTexel[i], accumulatedTexel[i], accumulatedTexture[i], textureSampledThisFrame[i], neighborhoodClamp[i], reprojectSpecular[i]);
    accumulate(gOutput[i], inputTexel[i], accumulatedTexel[i], roughness, moveFactor, reprojectSpecular[i]);
  }
#pragma unroll_loop_end
}