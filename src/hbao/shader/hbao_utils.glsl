#include <sampleBlueNoise>

// source: https://github.com/mrdoob/three.js/blob/342946c8392639028da439b6dc0597e58209c696/examples/js/shaders/SAOShader.js#L123
float getViewZ(const float depth) {
#ifdef PERSPECTIVE_CAMERA
    return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
#else
    return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
#endif
}

// source: https://github.com/N8python/ssao/blob/master/EffectShader.js#L52
vec3 getWorldPos(const float depth, const vec2 coord) {
    float z = depth * 2.0 - 1.0;
    vec4 clipSpacePosition = vec4(coord * 2.0 - 1.0, z, 1.0);
    vec4 viewSpacePosition = inverseProjectionMatrix * clipSpacePosition;

    // Perspective division
    vec4 worldSpacePosition = cameraMatrixWorld * viewSpacePosition;
    worldSpacePosition.xyz /= worldSpacePosition.w;

    return worldSpacePosition.xyz;
}

vec3 slerp(const vec3 a, const vec3 b, const float t) {
    float cosAngle = dot(a, b);
    float angle = acos(cosAngle);

    if (abs(angle) < 0.001) {
        return mix(a, b, t);
    }

    float sinAngle = sin(angle);
    float t1 = sin((1.0 - t) * angle) / sinAngle;
    float t2 = sin(t * angle) / sinAngle;

    return (a * t1) + (b * t2);
}

vec3 computeWorldNormal(const float unpackedDepth, const vec2 uv) {
    vec2 uv0 = uv;
    vec2 uv1 = uv + vec2(1., 0.) / texSize;
    vec2 uv2 = uv + vec2(0., 1.) / texSize;

    float depth0 = unpackedDepth;
    float depth1 = textureLod(depthTexture, uv1, 0.0).r;
    float depth2 = textureLod(depthTexture, uv2, 0.0).r;

    vec3 p0 = getWorldPos(depth0, uv0);
    vec3 p1 = getWorldPos(depth1, uv1);
    vec3 p2 = getWorldPos(depth2, uv2);

    vec3 normal = normalize(cross(p2 - p0, p1 - p0));

    return -normal;
}

vec3 getWorldNormal(const float unpackedDepth, const vec2 uv) {
#ifdef useNormalTexture
    vec3 worldNormal = unpackRGBToNormal(textureLod(normalTexture, uv, 0.).rgb);

    worldNormal = (vec4(worldNormal, 1.) * viewMatrix).xyz;  // view-space to world-space
    return normalize(worldNormal);
#else
    return computeWorldNormal(unpackedDepth, uv);  // compute world normal from depth
#endif
}

// source: https://www.shadertoy.com/view/cll3R4
vec3 cosineSampleHemisphere(const vec3 n, const vec2 u) {
    float r = sqrt(u.x);
    float theta = 2.0 * PI * u.y;

    vec3 b = normalize(cross(n, vec3(0.0, 1.0, 1.0)));
    vec3 t = cross(b, n);

    return normalize(r * sin(theta) * b + sqrt(1.0 - u.x) * n + r * cos(theta) * t);
}

vec3 computeNormal(vec3 worldPos, vec2 vUv) {
    vec2 resolution = texSize;
    vec2 downUv = vUv + vec2(0.0, 1.0 / resolution.y);
    vec3 downPos = getWorldPos(texture2D(depthTexture, downUv).x, downUv).xyz;
    vec2 rightUv = vUv + vec2(1.0 / resolution.x, 0.0);
    vec3 rightPos = getWorldPos(texture2D(depthTexture, rightUv).x, rightUv).xyz;
    vec2 upUv = vUv - vec2(0.0, 1.0 / resolution.y);
    vec3 upPos = getWorldPos(texture2D(depthTexture, upUv).x, upUv).xyz;
    vec2 leftUv = vUv - vec2(1.0 / resolution.x, 0.0);
    ;
    vec3 leftPos = getWorldPos(texture2D(depthTexture, leftUv).x, leftUv).xyz;
    int hChoice;
    int vChoice;
    if (length(leftPos - worldPos) < length(rightPos - worldPos)) {
        hChoice = 0;
    } else {
        hChoice = 1;
    }
    if (length(upPos - worldPos) < length(downPos - worldPos)) {
        vChoice = 0;
    } else {
        vChoice = 1;
    }
    vec3 hVec;
    vec3 vVec;
    if (hChoice == 0 && vChoice == 0) {
        hVec = leftPos - worldPos;
        vVec = upPos - worldPos;
    } else if (hChoice == 0 && vChoice == 1) {
        hVec = leftPos - worldPos;
        vVec = worldPos - downPos;
    } else if (hChoice == 1 && vChoice == 1) {
        hVec = rightPos - worldPos;
        vVec = downPos - worldPos;
    } else if (hChoice == 1 && vChoice == 0) {
        hVec = rightPos - worldPos;
        vVec = worldPos - upPos;
    }
    return normalize(cross(hVec, vVec));
}