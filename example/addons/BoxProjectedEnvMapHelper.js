import * as THREE from "three"

// credits for the box-projecting shader code go to codercat (https://codercat.tk)

const worldposReplace = /* glsl */ `
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP )
    vec4 worldPosition = modelMatrix * vec4( transformed, 1.0 );

    #ifdef BOX_PROJECTED_ENV_MAP
        vWorldPosition = worldPosition.xyz;
    #endif
#endif
`

const boxProjectDefinitions = /*glsl */ `
#ifdef BOX_PROJECTED_ENV_MAP
    uniform vec3 envMapSize;
    uniform vec3 envMapPosition;
    varying vec3 vWorldPosition;
    
    vec3 parallaxCorrectNormal( vec3 v, vec3 cubeSize, vec3 cubePos ) {
        vec3 nDir = normalize( v );

        vec3 rbmax = ( .5 * cubeSize + cubePos - vWorldPosition ) / nDir;
        vec3 rbmin = ( -.5 * cubeSize + cubePos - vWorldPosition ) / nDir;

        vec3 rbminmax;

        rbminmax.x = ( nDir.x > 0. ) ? rbmax.x : rbmin.x;
        rbminmax.y = ( nDir.y > 0. ) ? rbmax.y : rbmin.y;
        rbminmax.z = ( nDir.z > 0. ) ? rbmax.z : rbmin.z;

        float correction = min( min( rbminmax.x, rbminmax.y ), rbminmax.z );
        vec3 boxIntersection = vWorldPosition + nDir * correction;
        
        return boxIntersection - cubePos;
    }
#endif
`

// will be inserted after "vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );"
const getIBLIrradiance_patch = /* glsl */ `
#ifdef BOX_PROJECTED_ENV_MAP
    worldNormal = parallaxCorrectNormal( worldNormal, envMapSize, envMapPosition );
#endif
`

// will be inserted after "reflectVec = inverseTransformDirection( reflectVec, viewMatrix );"
const getIBLRadiance_patch = /* glsl */ `
#ifdef BOX_PROJECTED_ENV_MAP
    reflectVec = parallaxCorrectNormal( reflectVec, envMapSize, envMapPosition );
#endif
`

export function useBoxProjectedEnvMap(shader, envMapPosition, envMapSize) {
	// defines
	shader.defines.BOX_PROJECTED_ENV_MAP = true

	// uniforms
	shader.uniforms.envMapPosition = {
		value: envMapPosition
	}

	shader.uniforms.envMapSize = {
		value: envMapSize
	}

	// vertex shader
	shader.vertexShader =
		"varying vec3 vWorldPosition;\n" + shader.vertexShader.replace("#include <worldpos_vertex>", worldposReplace)

	// fragment shader
	shader.fragmentShader =
		boxProjectDefinitions +
		"\n" +
		shader.fragmentShader
			.replace("#include <envmap_physical_pars_fragment>", THREE.ShaderChunk.envmap_physical_pars_fragment)
			.replace(
				"vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );",
				`
            vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
            ${getIBLIrradiance_patch}
            `
			)
			.replace(
				"reflectVec = inverseTransformDirection( reflectVec, viewMatrix );",
				`
            reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
            ${getIBLRadiance_patch}
            `
			)
}
