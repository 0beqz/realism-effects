// a basic shader to implement temporal resolving

uniform sampler2D inputTexture;
uniform sampler2D accumulatedTexture;
uniform sampler2D velocityTexture;
uniform sampler2D lastVelocityTexture;

uniform float blend;
uniform float correction;
uniform float samples;
uniform vec2 invTexSize;

varying vec2 vUv;

#define FLOAT_EPSILON           0.00001
#define FLOAT_ONE_MINUS_EPSILON 0.99999

const float alphaStep = 0.001;

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

void main() {
    vec4 inputTexel = textureLod(inputTexture, vUv, 0.0);

    bool isBackground = dot(inputTexel, inputTexel) == 3.;

    vec3 inputColor = transformColor(inputTexel.rgb);
    float alpha = inputTexel.a;

    vec4 accumulatedTexel;
    vec3 accumulatedColor;

    bool didReproject = false;

    vec4 velocity = textureLod(velocityTexture, vUv, 0.0);

    vec3 minNeighborColor = inputColor;
    vec3 maxNeighborColor = inputColor;

    vec4 neighborTexel;
    vec3 col;
    vec2 neighborUv;
    vec2 offset;

    vec2 reprojectedUv = vUv - velocity.xy;
    vec4 lastVelocity = textureLod(lastVelocityTexture, reprojectedUv, 0.0);

    float depth = 1. - velocity.b;
    float lastDepth = 1. - lastVelocity.b;

    float maxDepth = 0.;
    float lastMaxDepth = 0.;

    float neighborDepth;
    float lastNeighborDepth;
    float colorCount = 1.0;

#if defined(dilation) || defined(neighborhoodClamping)
    for (int x = -correctionRadius; x <= correctionRadius; x++) {
        for (int y = -correctionRadius; y <= correctionRadius; y++) {
            if (x != 0 || y != 0) {
                offset = vec2(x, y) * invTexSize;
                neighborUv = vUv + offset;

                if (neighborUv.x >= 0.0 && neighborUv.x <= 1.0 && neighborUv.y >= 0.0 && neighborUv.y <= 1.0) {
                    vec4 neigborDepthTexel = textureLod(velocityTexture, vUv + offset, 0.0);
                    neighborDepth = 1. - neigborDepthTexel.b;

                    int absX = abs(x);
                    int absY = abs(y);

                    if (absX <= 1 && absY <= 1) {
    #ifdef dilation

                        // prevents the flickering at the edges of geometries due to treating background pixels differently
                        if (neighborDepth > 0.) isBackground = false;

                        if (neighborDepth > maxDepth) maxDepth = neighborDepth;

                        vec2 reprojectedNeighborUv = reprojectedUv + vec2(x, y) * invTexSize;

                        vec4 lastNeigborDepthTexel = textureLod(lastVelocityTexture, reprojectedNeighborUv, 0.0);
                        lastNeighborDepth = 1. - lastNeigborDepthTexel.b;

                        if (lastNeighborDepth > lastMaxDepth) lastMaxDepth = lastNeighborDepth;
    #endif
                    }

    #ifdef neighborhoodClamping
                    // the neighbor pixel is invalid if it's too far away from this pixel

                    if (abs(depth - neighborDepth) < maxNeighborDepthDifference) {
                        neighborTexel = textureLod(inputTexture, neighborUv, 0.0);

                        col = neighborTexel.rgb;
                        col = transformColor(col);

                        minNeighborColor = min(col, minNeighborColor);
                        maxNeighborColor = max(col, maxNeighborColor);
                    }

    #endif
                }
            }
        }
    }

#endif

    // velocity
    reprojectedUv = vUv - velocity.xy;

// depth
#ifdef dilation
    depth = maxDepth;
    lastDepth = lastMaxDepth;
#endif

    float depthDiff = abs(depth - lastDepth);

    // the reprojected UV coordinates are inside the view
    if (reprojectedUv.x >= 0.0 && reprojectedUv.x <= 1.0 && reprojectedUv.y >= 0.0 && reprojectedUv.y <= 1.0) {
        didReproject = true;

        accumulatedTexel = textureLod(accumulatedTexture, reprojectedUv, 0.0);

        alpha = min(alpha, accumulatedTexel.a);
        alpha = min(alpha, blend);
        accumulatedColor = transformColor(accumulatedTexel.rgb);

        alpha = didReproject && depthDiff <= maxNeighborDepthDifference ? (alpha + alphaStep) : 0.0;

#ifdef neighborhoodClamping
        vec3 clampedColor = clamp(accumulatedColor, minNeighborColor, maxNeighborColor);

        accumulatedColor = mix(accumulatedColor, clampedColor, correction);
#endif

    } else {
        accumulatedColor = inputColor;
    }

    vec3 outputColor = inputColor;

    float s = alpha / alphaStep + 1.0;
    float temporalResolveMix = 1. - 1. / s;
    temporalResolveMix = min(temporalResolveMix, blend);

// the user's shader to compose a final outputColor from the inputTexel and accumulatedTexel
#ifdef useCustomComposeShader
    customComposeShader
#else
    outputColor = mix(inputColor, accumulatedColor, temporalResolveMix);
#endif

        gl_FragColor = vec4(undoColorTransform(outputColor), alpha);
}