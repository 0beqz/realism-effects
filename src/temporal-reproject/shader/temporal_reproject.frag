varying vec2 vUv;

uniform sampler2D velocityTexture;

uniform sampler2D depthTexture;
uniform sampler2D lastVelocityTexture;

uniform float blend;
uniform float neighborhoodClampIntensity;
uniform bool constantBlend;
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

uniform bool reset;

#define EPSILON 0.00001

#include <gbuffer_packing>
#include <packing>
#include <reproject>

void main() {
  vec2 dilatedUv = vUv;
  getVelocityNormalDepth(dilatedUv, velocity, worldNormal, depth);

  // ! todo: find better solution
  if (textureCount > 1 && depth == 1.0) {
    discard;
    return;
  }

  vec4 inputTexel[textureCount];
  vec4 accumulatedTexel[textureCount];
  bool textureSampledThisFrame[textureCount];

  vec4 encodedGI = textureLod(inputTexture[0], vUv, 0.0);

  inputTexel[0] = vec4(unpackHalf2x16(floatBitsToUint(encodedGI.r)), unpackHalf2x16(floatBitsToUint(encodedGI.g)));

  inputTexel[1] = vec4(unpackHalf2x16(floatBitsToUint(encodedGI.b)), unpackHalf2x16(floatBitsToUint(encodedGI.a)));

  textureSampledThisFrame[0] = inputTexel[0].r >= 0.;
  textureSampledThisFrame[1] = inputTexel[1].r >= 0.;

  if (textureSampledThisFrame[0]) {
    transformColor(inputTexel[0].rgb);
  } else {
    inputTexel[0].rgb = vec3(0.0);
  }

  if (textureSampledThisFrame[1]) {
    transformColor(inputTexel[1].rgb);
  } else {
    inputTexel[1].rgb = vec3(0.0);
  }

  roughness = max(0., inputTexel[0].a);

  texIndex = 0;

  float movement = dot(velocity, velocity);
  float moveFactor = min(movement / 0.00000001, 1.);

  vec3 worldPos = screenSpaceToWorldSpace(dilatedUv, depth, cameraMatrixWorld, projectionMatrixInverse);
  flatness = getFlatness(worldPos, worldNormal);
  vec3 viewPos = (viewMatrix * vec4(worldPos, 1.0)).xyz;
  viewDir = normalize(viewPos);
  vec3 viewNormal = (viewMatrix * vec4(worldNormal, 0.0)).xyz;
  viewAngle = dot(-viewDir, viewNormal);

  // reprojecting
  float rayLength = inputTexel[1].a;
  vec3 reprojectedUvDiffuse = getReprojectedUV(depth, worldPos, worldNormal, 0.0);
  vec3 reprojectedUvSpecular = rayLength == 0.0 ? reprojectedUvDiffuse : getReprojectedUV(depth, worldPos, worldNormal, rayLength);

#pragma unroll_loop_start
  for (int i = 0; i < textureCount; i++) {
    {
      vec2 uv = reprojectSpecular[i] ? reprojectedUvSpecular.xy : reprojectedUvDiffuse.xy;
      float confidence = reprojectSpecular[i] ? reprojectedUvSpecular.z : reprojectedUvDiffuse.z;

      // check if any reprojection was successful

      accumulatedTexel[i] = sampleReprojectedTexture(accumulatedTexture[i], uv);
      transformColor(accumulatedTexel[i].rgb);

      if (textureSampledThisFrame[i]) {
        accumulatedTexel[i].a++; // add one more frame

        if (neighborhoodClamp[i]) {
          vec3 clampedColor = accumulatedTexel[i].rgb;

          clampNeighborhood(inputTexture[i], clampedColor, inputTexel[i].rgb, neighborhoodClampRadius);

          float clampIntensity = neighborhoodClampIntensity * (reprojectSpecular[i] ? (1. - roughness) : 1.0);

          accumulatedTexel[i].rgb = mix(accumulatedTexel[i].rgb, clampedColor, clampIntensity);
        }
      } else {
        inputTexel[i].rgb = accumulatedTexel[i].rgb;
      }

      texIndex++;
    }
  }
#pragma unroll_loop_end

  texIndex = 0;

  // float m = 1. - delta / (1. / 60.);
  // float fpsAdjustedBlend = blend + max(0., (1. - blend) * m);

  vec3 outputColor;
  float temporalReprojectMix;

#pragma unroll_loop_start
  for (int i = 0; i < textureCount; i++) {
    {
      float confidence = reprojectSpecular[i] ? reprojectedUvSpecular.z : reprojectedUvDiffuse.z;
      confidence = pow(confidence, 0.25);

      if (constantBlend) {
        temporalReprojectMix = accumulatedTexel[i].a == 0.0 ? 0.0 : blend;
      } else {
        temporalReprojectMix = blend;

        if (reset)
          accumulatedTexel[i].a = 0.0;

        float accumBlend = 1. - 1. / (accumulatedTexel[i].a + 1.0);

        accumBlend = mix(0., accumBlend, confidence);

        // if we reproject from oblique angles to straight angles, we
        // get stretching and need to counteract it
        // accumulatedTexel[i].a = mix(accumulatedTexel[i].a, 0.0, angleMix * accumBlend);

        // accumBlend = 1. - 1. / (accumulatedTexel[i].a + 1.0);

        float maxValue = fullAccumulate ? mix(1., blend, moveFactor) : blend;

        // float roughnessMaximum = 0.25;

        // if (reprojectSpecular[i] && rayLength == 0. && roughness < roughnessMaximum) {
        //   float maxRoughnessValue = mix(0.8, maxValue, roughness / roughnessMaximum);
        //   maxValue = mix(maxValue, maxRoughnessValue, moveFactor);
        // }

        temporalReprojectMix = min(accumBlend, maxValue);

        // float lumDiff = min(abs(luminance(inputTexel[i].rgb) -
        //                         luminance(accumulatedTexel[i].rgb)),
        //                     1.);

        // float lumFactor = clamp(lumDiff * 1. - 0.5, 0., 1.);
        // temporalReprojectMix = mix(temporalReprojectMix, 0.9,
        //                            min(lumFactor * movement *
        //                            100000000., 1.));
      }

      outputColor = mix(inputTexel[i].rgb, accumulatedTexel[i].rgb, temporalReprojectMix);

      // calculate the alpha from temporalReprojectMix
      accumulatedTexel[i].a = 1. / (1. - temporalReprojectMix) - 1.;

      undoColorTransform(outputColor);

      gOutput[i] = vec4(outputColor, accumulatedTexel[i].a);

      texIndex++;
    }
  }
#pragma unroll_loop_end

// the user's shader to compose a final outputColor from the inputTexel and
// accumulatedTexel
#ifdef useTemporalReprojectCustomComposeShader
  temporalReprojectCustomComposeShader
#endif
}