if (isLastIteration) {
    vec3 viewNormal = (vec4(normal, 0.) * cameraMatrixWorld).xyz;

    // view-space position of the current texel
    vec3 viewPos = getViewPosition(depth);
    vec3 viewDir = normalize(viewPos);

    vec3 diffuseGi = denoised;
    vec3 specularGi = denoised2;

    // denoised = constructGlobalIllumination(diffuseGi, specularGi, viewDir, viewNormal, diffuse, emissive, roughness, metalness);
}