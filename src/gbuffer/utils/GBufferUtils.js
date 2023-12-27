const materialProps = [
	"vertexTangent",
	"vertexColors",
	"vertexAlphas",
	"vertexUvs",
	"uvsVertexOnly",
	"supportsVertexTextures",
	"instancing",
	"instancingColor",
	"side",
	"flatShading",
	"skinning",
	"doubleSided",
	"flipSided"
]

export const copyNecessaryProps = (originalMaterial, newMaterial) => {
	for (const props of materialProps) newMaterial[props] = originalMaterial[props]
}

export const keepMaterialMapUpdated = (mrtMaterial, originalMaterial, prop, define, useKey) => {
	if (useKey) {
		if (originalMaterial[prop] !== mrtMaterial[prop]) {
			mrtMaterial[prop] = originalMaterial[prop]
			mrtMaterial.uniforms[prop].value = originalMaterial[prop]

			if (originalMaterial[prop]) {
				mrtMaterial.defines[define] = ""
			} else {
				delete mrtMaterial.defines[define]
			}

			mrtMaterial.needsUpdate = true
		}
	} else if (mrtMaterial[prop] !== undefined) {
		mrtMaterial[prop] = undefined
		mrtMaterial.uniforms[prop].value = undefined
		delete mrtMaterial.defines[define]
		mrtMaterial.needsUpdate = true
	}
}

export const getVisibleChildren = object => {
	const queue = [object]
	const objects = []

	while (queue.length !== 0) {
		const mesh = queue.shift()
		if (mesh.material) objects.push(mesh)

		for (const c of mesh.children) {
			if (c.visible) queue.push(c)
		}
	}

	return objects
}
