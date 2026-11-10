/* eslint-disable @typescript-eslint/no-require-imports */
const { _applySigning } = require('../plugins/withReleaseSigning');

const fixture = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled true
        }
    }
}
`;

describe('withReleaseSigning', () => {
  it('points the release build type at the release signing config', () => {
    const out: string = _applySigning(fixture);
    expect(out).toContain('signingConfig signingConfigs.release');
    const debugBlock = out.slice(out.indexOf('buildTypes'), out.indexOf('release {', out.indexOf('buildTypes')));
    expect(debugBlock).toContain('signingConfig signingConfigs.debug');
  });

  it('reads the credentials only from Gradle properties', () => {
    const out: string = _applySigning(fixture);
    expect(out).toContain("project.property('SPEEDCLUB_UPLOAD_STORE_FILE')");
    expect(out).not.toMatch(/storePassword\s+['"]/);
  });

  it('fails release builds without credentials', () => {
    expect(_applySigning(fixture)).toContain('throw new GradleException');
  });

  it('is idempotent', () => {
    const once: string = _applySigning(fixture);
    expect(_applySigning(once)).toBe(once);
  });

  it('refuses an unknown template instead of shipping a debug-signed release', () => {
    expect(() => _applySigning('android { buildTypes { release { } } }')).toThrow(/signingConfigs/);
  });
});
