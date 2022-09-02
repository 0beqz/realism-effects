import { Vector3 } from "three"

export const createEnvMap = (scene, renderer, ssgiEffect) => {
	if (scene.getObjectByName("Object_2")) scene.getObjectByName("Object_2").visible = false
	if (scene.getObjectByName("boxes")) scene.getObjectByName("boxes").visible = false

	const env = ssgiEffect.generateBoxProjectedEnvMapFallback(
		renderer,
		new Vector3(0, 1, 0),
		new Vector3(9.9 * 2, 19.9, 9.9 * 2)
	)

	if (scene.getObjectByName("Object_2")) scene.getObjectByName("Object_2").visible = true
	if (scene.getObjectByName("boxes")) scene.getObjectByName("boxes").visible = true

	scene.environment = env
}
