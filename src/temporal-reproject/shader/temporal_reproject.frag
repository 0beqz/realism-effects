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

  inputTexel[0] = vec4(unpackHalf2x16(floatBitsToUint(encodedGI.r)),
                       unpackHalf2x16(floatBitsToUint(encodedGI.g)));

  inputTexel[1] = vec4(unpackHalf2x16(floatBitsToUint(encodedGI.b)),
                       unpackHalf2x16(floatBitsToUint(encodedGI.a)));

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
  float moveFactor = min(movement / 0.000000001, 1.);

  vec3 worldPos = screenSpaceToWorldSpace(dilatedUv, depth, cameraMatrixWorld,
                                          projectionMatrixInverse);
  flatness = getFlatness(worldPos, worldNormal);
  vec3 viewPos = (viewMatrix * vec4(worldPos, 1.0)).xyz;
  viewDir = normalize(viewPos);
  vec3 viewNormal = (viewMatrix * vec4(worldNormal, 0.0)).xyz;

  // get the angle between the view direction and the normal
  viewAngle = dot(-viewDir, viewNormal);

  vec2 reprojectedUvDiffuse = vec2(-10.0);
  vec2 reprojectedUvSpecular[textureCount];
  bool didReproject;
  bool reprojectHitPoint;
  float rayLength;

#pragma unroll_loop_start
  for (int i = 0; i < textureCount; i++) {
    rayLength = inputTexel[i].a;
    reprojectHitPoint = reprojectSpecular[i] && rayLength > 0.0;

    // specular (hit point reprojection)
    if (reprojectHitPoint) {
      reprojectedUvSpecular[i] =
          getReprojectedUV(depth, worldPos, worldNormal, rayLength);
    } else {
      // init to -1 to signify that reprojection failed
      reprojectedUvSpecular[i] = vec2(-1.0);
    }

    reprojectedUvDiffuse = getReprojectedUV(depth, worldPos, worldNormal, 0.0);

    // choose which UV coordinates to use for reprojecion
    didReproject =
        reprojectedUvSpecular[i].x >= 0.0 || reprojectedUvDiffuse.x >= 0.0;

    // check if any reprojection was successful
    if (!didReproject) { // invalid UV
      // reprojection was not successful -> reset to the input texel
      accumulatedTexel[i] = vec4(inputTexel[i].rgb, 0.0);

    } else {
      if (reprojectHitPoint && reprojectedUvSpecular[i].x >= 0.0) {
        accumulatedTexel[i] = sampleReprojectedTexture(
            accumulatedTexture[i], reprojectedUvSpecular[i]);
      } else {
        accumulatedTexel[i] = sampleReprojectedTexture(accumulatedTexture[i],
                                                       reprojectedUvDiffuse);
      }

      transformColor(accumulatedTexel[i].rgb);

      if (textureSampledThisFrame[i]) {
        accumulatedTexel[i].a++; // add one more frame

        if (neighborhoodClamp[i]) {
          vec3 clampedColor = accumulatedTexel[i].rgb;

          clampNeighborhood(inputTexture[i], clampedColor, inputTexel[i].rgb,
                            neighborhoodClampRadius);

          float clampIntensity =
              neighborhoodClampIntensity *
              (reprojectSpecular[i] ? (1. - roughness) : 1.0);

          // ! todo: find good neighborhood clamp intensity
          accumulatedTexel[i].rgb =
              mix(accumulatedTexel[i].rgb, clampedColor, clampIntensity);
        }
      } else {
        inputTexel[i].rgb = accumulatedTexel[i].rgb;
      }
    }

    texIndex++;
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
      if (constantBlend) {
        temporalReprojectMix = accumulatedTexel[i].a == 0.0 ? 0.0 : blend;
      } else {
        temporalReprojectMix = blend;

        // if we reproject from oblique angles to straight angles, we get
        // stretching and need to counteract it
        accumulatedTexel[i].a = mix(accumulatedTexel[i].a, 0.0, angleMix);

        if (reset)
          accumulatedTexel[i].a = 0.0;

        float maxValue = fullAccumulate ? 1. : blend;

        float roughnessMaximum = 0.25;

        if (reprojectSpecular[i] && roughness < roughnessMaximum &&
            (rayLength > 10.0e3 || reprojectedUvSpecular[i].x < 0.)) {
          float maxRoughnessValue =
              mix(0.5, maxValue, roughness / roughnessMaximum);
          maxValue = mix(maxValue, maxRoughnessValue, moveFactor);
        }

        temporalReprojectMix =
            min(1. - 1. / (accumulatedTexel[i].a + 1.0), maxValue);

        // float lumDiff = min(abs(luminance(inputTexel[i].rgb) -
        //                         luminance(accumulatedTexel[i].rgb)),
        //                     1.);

        // float lumFactor = clamp(lumDiff * 1. - 0.5, 0., 1.);
        // temporalReprojectMix = mix(temporalReprojectMix, 0.9,
        //                            min(lumFactor * movement *
        //                            100000000., 1.));
      }

      outputColor =
          mix(inputTexel[i].rgb, accumulatedTexel[i].rgb, temporalReprojectMix);

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