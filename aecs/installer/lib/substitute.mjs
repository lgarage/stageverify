import path from 'node:path';

/**
 * @param {string} content
 * @param {object} ctx
 * @param {string} ctx.repoName
 * @param {string} ctx.profile
 * @param {string} ctx.brainRepoPath
 * @param {Record<string, string>} [ctx.bindings]
 */
export function substitutePlaceholders(content, ctx) {
  const orchestratorModel =
    ctx.profile === 'composer-default' ? 'Composer 2.5 Fast' : 'Sonnet 4.6';
  const defaultWorkerModel = orchestratorModel;
  const devPort = ctx.bindings?.devPort ?? 5173;
  const devPortRange = `${devPort}-${devPort + 3}`;
  const verifyArtifactGlob = ctx.bindings?.verifyArtifactGlob ?? 'screenshots/**/*.png';

  let out = content
    .replaceAll('<REPO>', ctx.repoName)
    .replaceAll('<BRAIN_REPO_PATH>', ctx.brainRepoPath)
    .replaceAll('<ORCHESTRATION_PROFILE>', ctx.profile)
    .replaceAll('<ORCHESTRATOR_MODEL>', orchestratorModel)
    .replaceAll('<DEFAULT_WORKER_MODEL>', defaultWorkerModel)
    .replaceAll('<DEV_PORT_RANGE>', devPortRange)
    .replaceAll('<VERIFY_ARTIFACT_GLOB>', verifyArtifactGlob);

  const deploy = ctx.bindings?.deploy ?? 'npm run deploy';
  const rulesDeploy = ctx.bindings?.rulesDeploy;

  out = out.replaceAll('<DEPLOY_COMMAND>', deploy);

  if (rulesDeploy) {
    out = out.replaceAll(
      '<RULES_DEPLOY_COMMAND_OR_NONE>',
      `If **Firestore rules** or **public unauthenticated writes** changed, also:\n\n\`\`\`\n${rulesDeploy}\n\`\`\``,
    );
  } else {
    out = out.replaceAll('<RULES_DEPLOY_COMMAND_OR_NONE>', '');
  }

  if (out.includes('<') && out.match(/<[A-Z_]+>/)) {
    const unresolved = [...out.matchAll(/<[A-Z_]+>/g)].map((m) => m[0]);
    throw new Error(`Unresolved placeholders after substitution: ${[...new Set(unresolved)].join(', ')}`);
  }

  return out;
}

/**
 * @param {string} targetRoot
 */
export function repoNameFromTarget(targetRoot) {
  return path.basename(path.resolve(targetRoot));
}
