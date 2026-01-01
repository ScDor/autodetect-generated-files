import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
			'@typescript-eslint/naming-convention': 'off',
			'curly': 'off',
			'eqeqeq': 'warn',
			'no-throw-literal': 'warn',
			'semi': ['warn', 'always'],
		},
	},
	{
		ignores: ['out/', 'dist/', '**/*.d.ts', 'coverage/'],
	},
);
