if (isLastIteration) {
    roughness *= roughness;

    vec3 viewNormal = (vec4(normal, 0.) * cameraMatrixWorld).xyz;

    // view-space position of the current texel
    vec3 viewPos = getViewPosition(depth);
    vec3 viewDir = normalize(viewPos);

    vec3 T, B;

    vec3 v = viewDir;  // incoming vector

    // convert view dir and view normal to world-space
    vec3 V = (vec4(v, 0.) * viewMatrix).xyz;  // invert view dir
    vec3 N = normal;

    Onb(N, T, B);

    V = ToLocal(T, B, N, V);

    // seems to approximate Fresnel very well
    vec3 H = SampleGGXVNDF(V, roughness, roughness, 0.25, 0.25);
    if (H.z < 0.0) H = -H;

    vec3 l = normalize(reflect(-V, H));
    l = ToWorld(T, B, N, l);

    // convert reflected vector back to view-space
    l = (vec4(l, 1.) * cameraMatrixWorld).xyz;
    l = normalize(l);

    if (dot(viewNormal, l) < 0.) l = -l;

    vec3 h = normalize(v + l);  // half vector

    // try to approximate the fresnel term we get when accumulating over multiple frames
    float VoH = max(EPSILON, dot(v, h));

    vec3 specularColor = denoised2;
    vec3 diffuseColor = denoised;

    // fresnel
    vec3 f0 = mix(vec3(0.04), diffuse, metalness);
    vec3 F = F_Schlick(f0, VoH);

    vec3 diffuseLightingColor = diffuseColor;
    vec3 diffuseComponent = diffuse * (1. - metalness) * (1. - F) * diffuseLightingColor;

    vec3 specularLightingColor = specularColor;
    vec3 specularComponent = specularLightingColor * F;

    // ! todo: fix direct light
    vec3 directLight = textureLod(directLightTexture, vUv, 0.).rgb;

    denoised = diffuseComponent + specularComponent + emissive;
}
