// a basic shader to implement temporal resolving

uniform sampler2D inputTexture;
uniform sampler2D accumulatedTexture;

uniform sampler2D velocityTexture;
uniform sampler2D hitPositionsTexture;

uniform sampler2D depthTexture;
uniform sampler2D lastDepthTexture;

uniform float blend;
uniform float correction;
uniform float samples;
uniform vec2 invTexSize;

varying vec2 vUv;

uniform mat4 projectionMatrix;
uniform mat4 cameraMatrixWorld;
uniform mat4 prevViewMatrix;
uniform vec3 cameraPos;

#define FLOAT_EPSILON           0.00001
#define FLOAT_ONE_MINUS_EPSILON 0.9999
#define ALPHA_STEP              0.001

#include <packing>

// idea from: https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/
vec3 transformColor(vec3 color) {
#ifdef logTransform
    return log(max(color, vec3(FLOAT_EPSILON)));
#else
    return color;
#endif
}

vec3 undoColorTransform(vec3 color) {
#ifdef logTransform
    return exp(color);
#else
    return color;
#endif
}

vec2 viewSpaceToScreenSpace(vec3 position) {
    vec4 projectedCoord = projectionMatrix * vec4(position, 1.0);
    projectedCoord.xy /= projectedCoord.w;
    // [-1, 1] --> [0, 1] (NDC to screen position)
    projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;

    return projectedCoord.xy;
}

vec3 screenSpaceToWorldSpace(const vec2 uv, const float depth) {
    vec4 ndc = vec4(
        (uv.x - 0.5) * 2.0,
        (uv.y - 0.5) * 2.0,
        (depth - 0.5) * 2.0,
        1.0);

    vec4 clip = inverse(projectionMatrix) * ndc;
    vec4 view = cameraMatrixWorld * (clip / clip.w);

    return view.xyz;
}

vec2 getVirtualHitPointUV(float rayLength, vec2 uv, float depth) {
    vec3 rayOrig = screenSpaceToWorldSpace(uv, depth);
    vec3 cameraRay = normalize(rayOrig - cameraPos);

    vec3 parallaxHitPoint = cameraPos + cameraRay * rayLength;
    vec4 reprojectedParallaxHitPoint = prevViewMatrix * vec4(parallaxHitPoint, 1.0);
    vec2 hitPointUv = viewSpaceToScreenSpace(reprojectedParallaxHitPoint.xyz);

    return hitPointUv;
}

void getNeighborhoodAABB(sampler2D tex, vec2 uv, inout vec3 minNeighborColor, inout vec3 maxNeighborColor) {
    for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
            if (x != 0 || y != 0) {
                vec2 offset = vec2(x, y) * invTexSize;
                vec2 neighborUv = uv + offset;

                vec4 neighborTexel = textureLod(tex, neighborUv, 0.0);

                vec3 col = transformColor(neighborTexel.rgb);

                minNeighborColor = min(col, minNeighborColor);
                maxNeighborColor = max(col, maxNeighborColor);
            }
        }
    }
}

bool validateReprojectedUV(vec2 reprojectedUv, float depth) {
    // the reprojected UV coordinates are inside the view
    if (all(greaterThanEqual(reprojectedUv, vec2(0.))) && all(lessThanEqual(reprojectedUv, vec2(1.)))) {
        float lastDepth = unpackRGBAToDepth(textureLod(lastDepthTexture, reprojectedUv, 0.));

        float depthDiff = abs(depth - lastDepth);

        // reproject the last frame if there was no disocclusion
        if (depthDiff < maxNeighborDepthDifference) {
            return true;
        }
    }

    return false;
    // return true;
}

void main() {
    vec4 inputTexel = textureLod(inputTexture, vUv, 0.0);

    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);
    float depth = unpackRGBAToDepth(depthTexel);

    vec3 inputColor = transformColor(inputTexel.rgb);
    float alpha = 1.0;

    vec4 accumulatedTexel;
    vec3 accumulatedColor;

    // velocity
    vec4 velocity = textureLod(velocityTexture, vUv, 0.0);
    velocity.xy = unpackRGBATo2Half(velocity) * 2. - 1.;

    if (all(lessThan(abs(velocity.xy), invTexSize * 0.25))) {
        velocity.xy = vec2(0.);
    }

    vec2 reprojectedUv = vUv - velocity.xy;
    // vec2 virtualHitPointUv = getVirtualHitPointUV(textureLod(rawInputTexture, vUv, 0.).a, vUv, depth);
    // reprojectedUv = virtualHitPointUv;

    if (validateReprojectedUV(reprojectedUv, depth)) {
        accumulatedTexel = textureLod(accumulatedTexture, reprojectedUv, 0.0);

        alpha = accumulatedTexel.a;
        alpha = min(alpha, blend);
        accumulatedColor = transformColor(accumulatedTexel.rgb);

        alpha += ALPHA_STEP;

#ifdef neighborhoodClamping
        vec3 minNeighborColor = inputColor;
        vec3 maxNeighborColor = inputColor;
        getNeighborhoodAABB(inputTexture, vUv, minNeighborColor, maxNeighborColor);

        vec3 clampedColor = clamp(accumulatedColor, minNeighborColor, maxNeighborColor);

        accumulatedColor = mix(accumulatedColor, clampedColor, correction);
#endif
    } else {
        accumulatedColor = inputColor;
        alpha = 0.0;
    }

    vec3 outputColor = inputColor;

    float pixelSample = alpha / ALPHA_STEP + 1.0;
    float temporalResolveMix = 1. - 1. / pixelSample;
    temporalResolveMix = min(temporalResolveMix, blend);

    outputColor = mix(inputColor, accumulatedColor, temporalResolveMix);

// the user's shader to compose a final outputColor from the inputTexel and accumulatedTexel
#ifdef useCustomComposeShader
    customComposeShader
#else
    gl_FragColor = vec4(undoColorTransform(outputColor), alpha);
#endif
}