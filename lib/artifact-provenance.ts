import { getAxionProjectRoot } from './project-root';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface ArtifactProvenance {
  source: 'cached' | 'bundled' | 'unavailable';
  status: 'verified' | 'unverified' | 'incompatible' | 'unavailable';
  modifiedAt?: string;
  dataCutoff?: string;
  generatedAt?: string;
  targetVersion?: string;
  preprocessingVersion?: string;
  modelSha256?: string;
  datasetSha256?: string;
  reproductionCommand?: string;
  splitDates?: {
    train?: string;
    tuning?: string;
    calibration?: string;
    untouchedTest?: string;
  };
  warning: string | null;
  limitations: string[];
}

export function getArtifactProvenance(filename: string, rootDir = getAxionProjectRoot()): ArtifactProvenance {
  const primaryRoot = path.resolve(rootDir, 'stock-ai', 'outputs');
  const bundledRoot = path.resolve(rootDir, 'data', 'stock-ai');
  const primary = path.resolve(primaryRoot, filename);
  const bundled = path.resolve(bundledRoot, filename);
  const unavailable: ArtifactProvenance = {
    source: 'unavailable', status: 'unavailable', warning: 'Artifact unavailable.', limitations: [],
  };
  if (!primary.startsWith(primaryRoot + path.sep) || !bundled.startsWith(bundledRoot + path.sep)) {
    return unavailable;
  }
  const isPrimary = fs.existsSync(primary);
  const file = isPrimary ? primary : bundled;
  if (!fs.existsSync(file)) return unavailable;
  const result: ArtifactProvenance = {
    source: isPrimary ? 'cached' : 'bundled',
    status: 'unverified',
    warning: 'Artifact has no compatible provenance manifest; its model history and performance are unverified.',
    limitations: ['Checksum and version verification do not establish predictive accuracy or production readiness.'],
  };
  try {
    result.modifiedAt = fs.statSync(file).mtime.toISOString();
    const manifestPath = path.join(isPrimary ? primaryRoot : bundledRoot, 'provenance.json');
    if (!fs.existsSync(manifestPath)) return result;
    const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('Invalid provenance manifest');
    }
    const manifestFields = manifest as Record<string, unknown>;
    const artifactMetadata = manifestFields.artifact_metadata as Record<string, Record<string, unknown>> | undefined;
    const fields = { ...manifestFields, ...artifactMetadata?.[filename] };
    result.targetVersion = typeof fields.target_version === 'string' ? fields.target_version : undefined;
    result.preprocessingVersion = typeof fields.preprocessing_version === 'string' ? fields.preprocessing_version : undefined;
    result.dataCutoff = typeof fields.data_cutoff === 'string' ? fields.data_cutoff : undefined;
    result.generatedAt = typeof fields.generated_at === 'string' ? fields.generated_at : undefined;
    result.modelSha256 = typeof fields.model_sha256 === 'string' ? fields.model_sha256 : undefined;
    result.datasetSha256 = typeof fields.dataset_sha256 === 'string' ? fields.dataset_sha256 : undefined;
    result.reproductionCommand = typeof fields.reproduction_command === 'string' ? fields.reproduction_command : undefined;
    if (fields.split_dates && typeof fields.split_dates === 'object' && !Array.isArray(fields.split_dates)) {
      const sd = fields.split_dates as Record<string, unknown>;
      result.splitDates = {
        train: typeof sd.train === 'string' ? sd.train : undefined,
        tuning: typeof sd.tuning === 'string' ? sd.tuning : undefined,
        calibration: typeof sd.calibration === 'string' ? sd.calibration : undefined,
        untouchedTest: typeof sd.untouched_test === 'string' ? sd.untouched_test : undefined,
      };
    }
    if (Array.isArray(fields.limitations)) {
      result.limitations.push(...fields.limitations.filter((value): value is string => typeof value === 'string'));
    }
    const artifacts = fields.artifacts;
    const artifactKey = path.relative(isPrimary ? primaryRoot : bundledRoot, file).split(path.sep).join('/');
    const expectedHash = artifacts && typeof artifacts === 'object' && !Array.isArray(artifacts)
      ? (artifacts as Record<string, unknown>)[artifactKey]
      : undefined;
    if (result.targetVersion !== '2.0-executable' || result.preprocessingVersion !== '2.0-temporal-isolated'
        || typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
      result.status = 'incompatible';
      result.warning = 'Artifact manifest lacks a compatible target, preprocessing version, or full checksum.';
      return result;
    }
    const actualHash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (actualHash !== expectedHash.toLowerCase()) {
      result.status = 'incompatible';
      result.warning = 'Artifact content does not match its provenance checksum.';
      return result;
    }
    result.status = 'verified';
    result.warning = null;
    return result;
  } catch {
    result.status = 'incompatible';
    result.warning = 'Artifact or provenance manifest could not be validated.';
    return result;
  }
}

export function isVerifiedArtifact(filename: string, rootDir = getAxionProjectRoot()): boolean {
  return getArtifactProvenance(filename, rootDir).status === 'verified';
}
