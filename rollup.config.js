import path from "path"
import babel from "@rollup/plugin-babel"
import resolve from "@rollup/plugin-node-resolve"
import glslify from "rollup-plugin-glslify"

const root = process.platform === "win32" ? path.resolve("/") : "/"
const external = id => !id.startsWith(".") && !id.startsWith(root)
const extensions = [".js", ".ts", ".ts", ".json"]

const getBabelOptions = ({ useESModules }) => ({
	babelrc: false,
	extensions,
	exclude: "**/node_modules/**",
	babelHelpers: "bundled",
	presets: [
		[
			"@babel/preset-env",
			{
				include: [
					"@babel/plugin-proposal-private-methods",
					"@babel/plugin-proposal-class-properties",
					"@babel/plugin-proposal-object-rest-spread"
				],
				bugfixes: true,
				loose: true,
				modules: false,
				targets: "> 1%, not dead, not ie 11, not op_mini all"
			}
		]
	]
})

export default [
	{
		input: `./src/index.js`,
		output: { file: `dist/index.js`, format: "esm" },
		external,
		plugins: [glslify(), babel(getBabelOptions({ useESModules: true })), resolve({ extensions })]
	},
	{
		input: `./src/index.js`,
		output: { file: `dist/index.cjs`, format: "cjs" },
		external,
		plugins: [glslify(), babel(getBabelOptions({ useESModules: false })), resolve({ extensions })]
	}
]
