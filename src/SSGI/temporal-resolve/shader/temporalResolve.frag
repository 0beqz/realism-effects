varying vec2 vUv;

uniform sampler2D inputTexture;
uniform sampler2D accumulatedTexture;

uniform sampler2D velocityTexture;

uniform sampler2D depthTexture;
uniform sampler2D lastDepthTexture;

uniform sampler2D normalTexture;
uniform sampler2D lastNormalTexture;

uniform float blend;
uniform bool constantBlend;
uniform bool blendStatic;
uniform vec2 invTexSize;

uniform mat4 projectionMatrix;
uniform mat4 projectionMatrixInverse;
uniform mat4 cameraMatrixWorld;
uniform mat4 prevViewMatrix;
uniform mat4 prevCameraMatrixWorld;
uniform vec3 cameraPos;
uniform vec3 prevCameraPos;

#define EPSILON 0.00001

#include <packing>
#include <reprojection>

void main() {
    vec4 depthTexel;
    float depth;
    vec2 uv;

    getDepthAndUv(depth, uv, depthTexel);

#ifndef neighborhoodClamping
    if (dot(depthTexel.rgb, depthTexel.rgb) == 0.0) {
        discard;
        return;
    }
#endif

    vec4 inputTexel = textureLod(inputTexture, vUv, 0.0);
    vec3 inputColor = inputTexel.rgb;

#ifdef logTransform
    inputColor = transformColor(inputColor);
#endif

    vec3 accumulatedColor;
    float alpha = 1.0;

    vec4 normalTexel = textureLod(normalTexture, uv, 0.);
    vec3 worldNormal = unpackRGBToNormal(normalTexel.xyz);
    worldNormal = normalize((vec4(worldNormal, 1.) * viewMatrix).xyz);
    vec3 worldPos = screenSpaceToWorldSpace(uv, depth, cameraMatrixWorld);

    vec2 reprojectedUv = getReprojectedUV(vUv, depth, worldPos, worldNormal, 0.);

    if (reprojectedUv.x != -1.0) {
        vec4 accumulatedTexel = sampleReprojectedTexture(accumulatedTexture, reprojectedUv);

        accumulatedColor = transformColor(accumulatedTexel.rgb);
        alpha = accumulatedTexel.a + 1.0;  // add one more frame

#ifdef neighborhoodClamping
        vec3 minNeighborColor = inputColor;
        vec3 maxNeighborColor = inputColor;
        getNeighborhoodAABB(inputTexture, vUv, minNeighborColor, maxNeighborColor);

        accumulatedColor = clamp(accumulatedColor, minNeighborColor, maxNeighborColor);
#endif
    } else {
        // reprojection invalid possibly due to disocclusion
        accumulatedColor = inputColor;
        alpha = 1.0;
    }

    vec3 outputColor = inputColor;

    vec2 deltaUv = vUv - reprojectedUv;
    bool didMove = dot(deltaUv, deltaUv) > 0.;
    float maxValue = (!blendStatic || didMove) ? blend : 1.0;

    float temporalResolveMix = blend;
    if (!constantBlend) {
        if (dot(inputColor, inputColor) == 0.0) {
            alpha = max(1., alpha - 1.);
            inputColor = accumulatedColor;
        }

        temporalResolveMix = min(1. - 1. / alpha, maxValue);
    }

// the user's shader to compose a final outputColor from the inputTexel and accumulatedTexel
#ifdef useCustomComposeShader
    customComposeShader
#else
    outputColor = mix(inputColor, accumulatedColor, temporalResolveMix);

    gl_FragColor = vec4(undoColorTransform(outputColor), alpha);
#endif
}