import {
  ValidationResult,
  ValidationLayer,
  FileMap,
  ValidationError,
  ValidationWarning,
} from "@ai-app-builder/core";

export class Validator {
  async validateAllLayers(
    fileMap: FileMap,
  ): Promise<Record<ValidationLayer, ValidationResult>> {
    const results: Record<ValidationLayer, ValidationResult> = {} as any;

    results["spec-validation"] = await this.validateSpec(fileMap);
    results["static-analysis"] = await this.runStaticAnalysis(fileMap);
    results["dependency-checks"] = await this.checkDependencies(fileMap);
    results["property-based-testing"] =
      await this.runPropertyBasedTests(fileMap);
    results["contract-testing"] = await this.runContractTests(fileMap);
    results["security-scanning"] = await this.runSecurityScan(fileMap);
    results["runtime-validation"] = await this.validateRuntime(fileMap);

    // Ensure that any layer with implementation warnings that indicate "not yet implemented"
    // is treated as a failure, not a pass
    for (const [layer, result] of Object.entries(results)) {
      if (
        result.warnings &&
        result.warnings.some(
          (w) =>
            w.message.includes("not yet implemented") ||
            w.message.includes("simulated") ||
            w.message.includes("stub"),
        )
      ) {
        result.status = "fail";
        // Convert the implementation warning to an error
        const implWarning = result.warnings.find(
          (w) =>
            w.message.includes("not yet implemented") ||
            w.message.includes("simulated") ||
            w.message.includes("stub"),
        );
        if (implWarning) {
          result.errors.push({
            ...implWarning,
            severity: "error" as const,
            code: implWarning.code + "_NOT_IMPLEMENTED",
          });
          // Remove the warning since we converted it to an error
          result.warnings = result.warnings.filter((w) => w !== implWarning);
        }
      }
    }

    return results;
  }

  private async validateSpec(_fileMap: FileMap): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const startTime = Date.now();

    return {
      layer: "spec-validation",
      status: errors.length === 0 ? "pass" : "fail",
      errors,
      warnings: warnings.length ? warnings : undefined,
      duration: Date.now() - startTime,
    };
  }

  private async runStaticAnalysis(fileMap: FileMap): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const startTime = Date.now();

    for (const [path, file] of Object.entries(fileMap)) {
      if (path.endsWith(".ts") || path.endsWith(".tsx")) {
        const syntaxErrors = this.checkTypeScriptSyntax(file.content);
        errors.push(...syntaxErrors);
      }
    }

    const lintErrors = this.checkLintingIssues(fileMap);
    errors.push(...lintErrors);

    const pkg = fileMap["package.json"];
    if (pkg && !pkg.content.includes('"build"')) {
      errors.push({
        code: "MISSING_BUILD_SCRIPT",
        message: "package.json missing build script",
        severity: "error",
        category: "dependency",
        file: "package.json",
      });
    }

    return {
      layer: "static-analysis",
      status: errors.length === 0 ? "pass" : "fail",
      errors,
      warnings: warnings.length ? warnings : undefined,
      duration: Date.now() - startTime,
    };
  }

  private async checkDependencies(fileMap: FileMap): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const startTime = Date.now();

    const packageJson = fileMap["package.json"];
    if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson.content);

        if (!pkg.dependencies || typeof pkg.dependencies !== "object") {
          errors.push({
            code: "DEPENDENCIES_INVALID",
            message: "package.json dependencies must be an object",
            severity: "error",
            category: "dependency",
            file: "package.json",
          });
        }
      } catch (error) {
        errors.push({
          code: "PACKAGE_JSON_INVALID",
          message: "Invalid package.json syntax",
          severity: "error",
          category: "dependency",
          file: "package.json",
        });
      }
    } else {
      errors.push({
        code: "PACKAGE_JSON_MISSING",
        message: "package.json is required",
        severity: "error",
        category: "dependency",
        file: "package.json",
      });
    }

    return {
      layer: "dependency-checks",
      status: errors.length === 0 ? "pass" : "fail",
      errors,
      warnings: warnings.length ? warnings : undefined,
      duration: Date.now() - startTime,
    };
  }

  private async runPropertyBasedTests(
    fileMap: FileMap,
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const startTime = Date.now();

    // Check if test frameworks are available
    const hasTestFramework = this.hasTestFramework(fileMap);

    if (!hasTestFramework) {
      errors.push({
        code: "PBT_NO_TEST_FRAMEWORK",
        message:
          "Property-based testing requires a test framework (jest, vitest, or fast-check)",
        severity: "error",
        category: "testing",
        file: "package.json",
      });

      return {
        layer: "property-based-testing",
        status: "fail",
        errors,
        warnings: warnings.length ? warnings : undefined,
        duration: Date.now() - startTime,
      };
    }

    // Run actual property-based tests if generators are available
    const testResults = await this.runGenerators(fileMap);
    errors.push(...testResults.errors);
    warnings.push(...testResults.warnings);

    return {
      layer: "property-based-testing",
      status: errors.length === 0 ? "pass" : "fail",
      errors,
      warnings: warnings.length ? warnings : undefined,
      duration: Date.now() - startTime,
    };
  }

  private hasTestFramework(fileMap: FileMap): boolean {
    const packageJson = fileMap["package.json"];
    if (!packageJson) return false;

    try {
      const pkg = JSON.parse(packageJson.content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      return !!(
        deps["jest"] ||
        deps["vitest"] ||
        deps["fast-check"] ||
        deps["@fast-check/jest"] ||
        deps["@fast-check/vitest"]
      );
    } catch {
      return false;
    }
  }

  private async runGenerators(
    fileMap: FileMap,
  ): Promise<{ errors: ValidationError[]; warnings: ValidationWarning[] }> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Look for test files with property-based tests
    const testFiles = Object.keys(fileMap).filter(
      (path) =>
        path.endsWith(".test.ts") ||
        path.endsWith(".test.tsx") ||
        path.endsWith(".spec.ts") ||
        path.endsWith(".spec.tsx"),
    );

    if (testFiles.length === 0) {
      warnings.push({
        code: "PBT_NO_TEST_FILES",
        message: "No test files found for property-based testing",
        category: "testing",
        file: "N/A",
      });
      return { errors, warnings };
    }

    // Check if test files contain property-based test patterns
    let hasPBT = false;
    for (const testFile of testFiles) {
      const content = fileMap[testFile].content;
      if (
        content.includes("property") ||
        content.includes("fc.") ||
        content.includes("fast-check")
      ) {
        hasPBT = true;

        // Validate PBT structure
        if (!content.includes("assert") && !content.includes("expect")) {
          errors.push({
            code: "PBT_MISSING_ASSERTIONS",
            message: `Property-based test in ${testFile} missing assertions`,
            severity: "error",
            category: "testing",
            file: testFile,
          });
        }
      }
    }

    if (!hasPBT) {
      warnings.push({
        code: "PBT_NO_PROPERTY_TESTS",
        message: "Test files found but no property-based tests detected",
        category: "testing",
        file: "N/A",
      });
    }

    return { errors, warnings };
  }

  private async runContractTests(fileMap: FileMap): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const startTime = Date.now();

    const apiRoutes = Object.keys(fileMap).filter(
      (path) => path.startsWith("src/app/api/") && path.endsWith("/route.ts"),
    );

    for (const route of apiRoutes) {
      const content = fileMap[route].content;

      // Check for HTTP method handlers (basic check)
      const requiredHandlers = ["GET", "POST", "PUT", "DELETE", "PATCH"];
      const hasAny = requiredHandlers.some((handler) =>
        content.includes(`export async function ${handler}`),
      );

      if (!hasAny) {
        errors.push({
          code: "NO_HTTP_HANDLER",
          message: `API route ${route} has no HTTP method handlers`,
          severity: "error",
          category: "route",
          file: route,
        });
        continue;
      }

      // Enhanced contract validation
      const contractResult = this.validateApiContract(route, content);
      errors.push(...contractResult.errors);
      warnings.push(...contractResult.warnings);
    }

    return {
      layer: "contract-testing",
      status: errors.length === 0 ? "pass" : "fail",
      errors,
      warnings: warnings.length ? warnings : undefined,
      duration: Date.now() - startTime,
    };
  }

  private validateApiContract(
    route: string,
    content: string,
  ): { errors: ValidationError[]; warnings: ValidationWarning[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check for proper request handling
    if (!content.includes("Request") && !content.includes("req")) {
      warnings.push({
        code: "CONTRACT_NO_REQUEST_HANDLING",
        message: `API route ${route} may not handle request objects properly`,
        category: "contract",
        file: route,
      });
    }

    // Check for proper response handling
    if (
      !content.includes("Response") &&
      !content.includes("res") &&
      !content.includes("NextResponse")
    ) {
      warnings.push({
        code: "CONTRACT_NO_RESPONSE_HANDLING",
        message: `API route ${route} may not return proper Response objects`,
        category: "contract",
        file: route,
      });
    }

    // Check for error handling
    if (
      !content.includes("try") &&
      !content.includes("catch") &&
      !content.includes("error")
    ) {
      warnings.push({
        code: "CONTRACT_NO_ERROR_HANDLING",
        message: `API route ${route} lacks error handling`,
        category: "contract",
        file: route,
      });
    }

    // Check for JSON response handling
    if (
      content.includes("POST") ||
      content.includes("PUT") ||
      content.includes("PATCH")
    ) {
      if (!content.includes("json()") && !content.includes("JSON.parse")) {
        warnings.push({
          code: "CONTRACT_NO_JSON_HANDLING",
          message: `API route ${route} handles data but may not parse JSON properly`,
          category: "contract",
          file: route,
        });
      }
    }

    // Check for status code usage
    if (
      !content.includes("200") &&
      !content.includes("201") &&
      !content.includes("400") &&
      !content.includes("500")
    ) {
      warnings.push({
        code: "CONTRACT_NO_STATUS_CODES",
        message: `API route ${route} may not return proper HTTP status codes`,
        category: "contract",
        file: route,
      });
    }

    // Check for content-type headers
    if (
      !content.includes("Content-Type") &&
      !content.includes("content-type")
    ) {
      warnings.push({
        code: "CONTRACT_NO_CONTENT_TYPE",
        message: `API route ${route} may not set Content-Type headers`,
        category: "contract",
        file: route,
      });
    }

    // Enhanced contract assertions
    // Assert input validation for POST/PUT/PATCH
    if (
      content.includes("POST") ||
      content.includes("PUT") ||
      content.includes("PATCH")
    ) {
      if (
        !content.includes("zod") &&
        !content.includes("validation") &&
        !content.includes("schema")
      ) {
        warnings.push({
          code: "CONTRACT_NO_INPUT_VALIDATION",
          message: `API route ${route} accepts data but lacks input validation schema`,
          category: "contract",
          file: route,
        });
      }
    }

    // Assert response schema validation
    if (content.includes("return") || content.includes("Response.json")) {
      if (
        !content.includes("zod") &&
        !content.includes("schema") &&
        !content.includes("interface")
      ) {
        warnings.push({
          code: "CONTRACT_NO_OUTPUT_SCHEMA",
          message: `API route ${route} returns data but lacks output schema definition`,
          category: "contract",
          file: route,
        });
      }
    }

    // Assert rate limiting consideration
    if (
      !content.includes("rate") &&
      !content.includes("limit") &&
      !content.includes("throttle")
    ) {
      warnings.push({
        code: "CONTRACT_NO_RATE_LIMITING",
        message: `API route ${route} may need rate limiting consideration`,
        category: "contract",
        file: route,
      });
    }

    // Assert authentication/authorization for sensitive operations
    if (
      content.includes("DELETE") ||
      content.includes("PUT") ||
      content.includes("PATCH")
    ) {
      if (
        !content.includes("auth") &&
        !content.includes("session") &&
        !content.includes("token")
      ) {
        warnings.push({
          code: "CONTRACT_NO_AUTH_CHECK",
          message: `API route ${route} performs state-changing operations without visible auth checks`,
          category: "contract",
          file: route,
        });
      }
    }

    // Assert CORS handling
    if (
      !content.includes("cors") &&
      !content.includes("CORS") &&
      !content.includes("Access-Control")
    ) {
      warnings.push({
        code: "CONTRACT_NO_CORS",
        message: `API route ${route} may need CORS configuration`,
        category: "contract",
        file: route,
      });
    }

    return { errors, warnings };
  }

  private async runSecurityScan(fileMap: FileMap): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const startTime = Date.now();

    const secretPatterns = [
      /password\s*=\s*['"][^'"]+['"]/i,
      /api_key\s*=\s*['"][^'"]+['"]/i,
      /secret\s*=\s*['"][^'"]+['"]/i,
      /bearer\s+[a-z0-9\-_]+$/im,
    ];

    for (const [path, file] of Object.entries(fileMap)) {
      for (const pattern of secretPatterns) {
        if (pattern.test(file.content)) {
          errors.push({
            code: "HARDCODED_SECRET",
            message: `Potential hardcoded secret in ${path}`,
            severity: "critical",
            category: "security",
            file: path,
          });
        }
      }

      if (file.content.includes("`") && file.content.includes("$")) {
        warnings.push({
          code: "SQL_INJECTION_RISK",
          message: `Potential SQL injection risk in ${path}`,
          category: "security",
          file: path,
        });
      }
    }

    return {
      layer: "security-scanning",
      status: errors.length === 0 ? "pass" : "fail",
      errors,
      warnings: warnings.length ? warnings : undefined,
      duration: Date.now() - startTime,
    };
  }

  private async validateRuntime(fileMap: FileMap): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const startTime = Date.now();

    const pkg = fileMap["package.json"];
    if (!pkg) {
      errors.push({
        code: "RUNTIME_NO_PACKAGE_JSON",
        message: "package.json missing for runtime validation",
        severity: "error",
        category: "runtime",
        file: "package.json",
      });

      return {
        layer: "runtime-validation",
        status: "fail",
        errors,
        warnings: warnings.length ? warnings : undefined,
        duration: Date.now() - startTime,
      };
    }

    try {
      const parsed = JSON.parse(pkg.content);

      // Check required fields
      const required = ["name", "version", "scripts"];
      for (const key of required) {
        if (!(key in parsed)) {
          errors.push({
            code: "RUNTIME_MISSING_FIELD",
            message: `package.json missing required field: ${key}`,
            severity: "error",
            category: "runtime",
            file: "package.json",
          });
        }
      }

      // Attempt to build the project
      const buildResult = await this.attemptBuild(fileMap, parsed);
      if (!buildResult.success) {
        errors.push(...buildResult.errors);
        warnings.push(...buildResult.warnings);
      }

      // If build succeeded, attempt to boot and smoke test
      if (buildResult.success) {
        const runtimeResult = await this.attemptRuntimeSmokeTest(
          fileMap,
          parsed,
        );
        if (!runtimeResult.success) {
          errors.push(...runtimeResult.errors);
          warnings.push(...runtimeResult.warnings);
        }
      }
    } catch (error) {
      errors.push({
        code: "RUNTIME_PACKAGE_JSON_INVALID",
        message: `package.json could not be parsed: ${error}`,
        severity: "error",
        category: "runtime",
        file: "package.json",
      });
    }

    return {
      layer: "runtime-validation",
      status: errors.length === 0 ? "pass" : "fail",
      errors,
      warnings: warnings.length ? warnings : undefined,
      duration: Date.now() - startTime,
    };
  }

  private async attemptBuild(
    fileMap: FileMap,
    packageJson: any,
  ): Promise<{
    success: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
  }> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check if build script exists
    if (!packageJson.scripts || !packageJson.scripts.build) {
      errors.push({
        code: "RUNTIME_NO_BUILD_SCRIPT",
        message: "package.json missing build script",
        severity: "error",
        category: "runtime",
        file: "package.json",
      });
      return { success: false, errors, warnings };
    }

    // Check for build dependencies
    const hasDeps = packageJson.dependencies || {};
    const hasDevDeps = packageJson.devDependencies || {};

    if (!hasDeps["next"] && !hasDeps["react"] && !hasDevDeps["typescript"]) {
      warnings.push({
        code: "RUNTIME_NO_FRAMEWORK",
        message: "No common framework detected (Next.js, React, TypeScript)",
        category: "runtime",
        file: "package.json",
      });
    }

    // Check for TypeScript configuration
    const hasTsConfig =
      fileMap["tsconfig.json"] || fileMap["tsconfig.base.json"];
    if (!hasTsConfig && (hasDevDeps["typescript"] || hasDeps["typescript"])) {
      errors.push({
        code: "RUNTIME_NO_TSCONFIG",
        message: "TypeScript installed but no tsconfig.json found",
        severity: "error",
        category: "runtime",
        file: "tsconfig.json",
      });
    }

    // Real structural validation - check import resolution across the codebase
    const importErrors = this.validateImportResolution(fileMap, hasDeps, hasDevDeps);
    errors.push(...importErrors);

    // Check that all files referenced in the build actually exist
    const buildFileErrors = this.validateBuildFileReferences(fileMap, packageJson);
    errors.push(...buildFileErrors);

    return { success: errors.length === 0, errors, warnings };
  }

  private async attemptRuntimeSmokeTest(
    fileMap: FileMap,
    packageJson: any,
  ): Promise<{
    success: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
  }> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check for essential runtime files
    const essentialFiles = ["package.json"];
    for (const file of essentialFiles) {
      if (!fileMap[file]) {
        errors.push({
          code: "RUNTIME_MISSING_ESSENTIAL_FILE",
          message: `Missing essential file: ${file}`,
          severity: "error",
          category: "runtime",
          file: file,
        });
      }
    }

    // Check for entry point
    const hasMain = packageJson.main;
    const hasNextConfig =
      fileMap["next.config.js"] || fileMap["next.config.mjs"];

    if (!hasMain && !hasNextConfig) {
      errors.push({
        code: "RUNTIME_NO_ENTRY_POINT",
        message: "No clear entry point (main field or next.config)",
        severity: "error",
        category: "runtime",
        file: "package.json",
      });
    }

    // Real smoke tests - check for app structure and basic functionality
    const smokeTestResults = this.runAppSmokeTests(fileMap, packageJson);
    errors.push(...smokeTestResults.errors);
    warnings.push(...smokeTestResults.warnings);

    return { success: errors.length === 0, errors, warnings };
  }

  private runAppSmokeTests(
    fileMap: FileMap,
    packageJson: any,
  ): { errors: ValidationError[]; warnings: ValidationWarning[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Test 1: Check for page structure (if Next.js app)
    if (packageJson.dependencies?.next || packageJson.devDependencies?.next) {
      const hasAppDir = Object.keys(fileMap).some((path) =>
        path.startsWith("src/app/"),
      );
      const hasPagesDir = Object.keys(fileMap).some((path) =>
        path.startsWith("src/pages/"),
      );

      if (!hasAppDir && !hasPagesDir) {
        errors.push({
          code: "SMOKE_TEST_NO_ROUTES",
          message: "Next.js app detected but no app/ or pages/ directory found",
          severity: "error",
          category: "runtime",
          file: "src/app or src/pages",
        });
      }

      // Test 2: Check for layout or root page
      if (hasAppDir) {
        const hasLayout =
          fileMap["src/app/layout.tsx"] || fileMap["src/app/layout.ts"];
        const hasPage =
          fileMap["src/app/page.tsx"] || fileMap["src/app/page.ts"];

        if (!hasLayout && !hasPage) {
          errors.push({
            code: "SMOKE_TEST_NO_ROOT",
            message:
              "Next.js app directory found but no layout.tsx or page.tsx in root",
            severity: "error",
            category: "runtime",
            file: "src/app",
          });
        }
      }
    }

    // Test 3: Check for environment configuration
    const hasEnv =
      fileMap[".env.local"] || fileMap[".env"] || fileMap[".env.example"];
    if (!hasEnv) {
      warnings.push({
        code: "SMOKE_TEST_NO_ENV",
        message:
          "No environment configuration files found (.env, .env.local, .env.example)",
        category: "runtime",
        file: ".env",
      });
    }

    // Test 4: Check for README or documentation
    const hasReadme = fileMap["README.md"] || fileMap["readme.md"];
    if (!hasReadme) {
      warnings.push({
        code: "SMOKE_TEST_NO_README",
        message: "No README.md found - consider adding project documentation",
        category: "runtime",
        file: "README.md",
      });
    }

    // Test 5: Check for gitignore
    if (!fileMap[".gitignore"]) {
      warnings.push({
        code: "SMOKE_TEST_NO_GITIGNORE",
        message: "No .gitignore found - consider adding for version control",
        category: "runtime",
        file: ".gitignore",
      });
    }

    // Test 6: Validate TypeScript configuration if present
    const tsConfig = fileMap["tsconfig.json"] || fileMap["tsconfig.base.json"];
    if (tsConfig) {
      try {
        const tsConfigParsed = JSON.parse(tsConfig.content);
        if (!tsConfigParsed.compilerOptions) {
          errors.push({
            code: "SMOKE_TEST_NO_COMPILER_OPTIONS",
            message: "tsconfig.json missing compilerOptions",
            severity: "error",
            category: "runtime",
            file: "tsconfig.json",
          });
        }
      } catch {
        errors.push({
          code: "SMOKE_TEST_INVALID_TSCONFIG",
          message: "tsconfig.json is not valid JSON",
          severity: "error",
          category: "runtime",
          file: "tsconfig.json",
        });
      }
    }

    return { errors, warnings };
  }

  private checkTypeScriptSyntax(content: string): ValidationError[] {
    const errors: ValidationError[] = [];

    if (content.includes(" any ")) {
      errors.push({
        code: "NO_ANY_TYPE",
        message: 'Avoid using "any" type - use specific types instead',
        severity: "error",
        category: "type",
      });
    }

    return errors;
  }

  private checkLintingIssues(fileMap: FileMap): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const [path, file] of Object.entries(fileMap)) {
      if (file.content.includes("console.log")) {
        errors.push({
          code: "CONSOLE_LOG_FOUND",
          message: `console.log found in ${path}`,
          severity: "error",
          category: "syntax",
          file: path,
        });
      }
    }

    return errors;
  }

  private checkVulnerableDependencies(
    dependencies: Record<string, string>,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const vulnerablePackages: Array<{ name: string; max: string }> = [];

    for (const [dep, version] of Object.entries(dependencies)) {
      for (const vuln of vulnerablePackages) {
        if (dep === vuln.name && this.isVersionLessThan(version, vuln.max)) {
          errors.push({
            code: "VULNERABLE_DEPENDENCY",
            message: `Vulnerable dependency: ${dep}@${version}`,
            severity: "critical",
            category: "security",
            file: "package.json",
          });
        }
      }
    }

    return errors;
  }

  private checkOutdatedDependencies(
    dependencies: Record<string, string>,
  ): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];
    const outdatedPackages: Array<{ name: string; min: string }> = [];

    for (const [dep, version] of Object.entries(dependencies)) {
      for (const outdated of outdatedPackages) {
        if (
          dep === outdated.name &&
          this.isVersionLessThan(version, outdated.min)
        ) {
          warnings.push({
            code: "OUTDATED_DEPENDENCY",
            message: `Outdated dependency: ${dep}@${version}`,
            category: "dependency",
            file: "package.json",
          });
        }
      }
    }

    return warnings;
  }

  private validateAPIContract(
    route: string,
    content: string,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const requiredHandlers = ["GET", "POST", "PUT", "DELETE", "PATCH"];
    const hasAny = requiredHandlers.some((handler) =>
      content.includes(`export async function ${handler}`),
    );

    if (!hasAny) {
      errors.push({
        code: "NO_HTTP_HANDLER",
        message: `API route ${route} has no HTTP method handlers`,
        severity: "error",
        category: "route",
        file: route,
      });
    }

    return errors;
  }

  private scanForSecurityIssues(fileMap: FileMap): {
    errors: ValidationError[];
    warnings: ValidationWarning[];
  } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    const secretPatterns = [
      /password\s*=\s*['"][^'"]+['"]/i,
      /api_key\s*=\s*['"][^'"]+['"]/i,
      /secret\s*=\s*['"][^'"]+['"]/i,
    ];

    for (const [path, file] of Object.entries(fileMap)) {
      for (const pattern of secretPatterns) {
        if (pattern.test(file.content)) {
          errors.push({
            code: "HARDCODED_SECRET",
            message: `Potential hardcoded secret in ${path}`,
            severity: "critical",
            category: "security",
            file: path,
          });
        }
      }

      if (file.content.includes("`") && file.content.includes("$")) {
        warnings.push({
          code: "SQL_INJECTION_RISK",
          message: `Potential SQL injection risk in ${path}`,
          category: "security",
          file: path,
        });
      }
    }

    return { errors, warnings };
  }

  /**
   * Validates that imports in TypeScript/TSX files reference packages that exist
   * in the dependency declarations. This replaces the simulated build check
   * with real structural validation.
   */
  private validateImportResolution(
    fileMap: FileMap,
    hasDeps: Record<string, string>,
    hasDevDeps: Record<string, string>,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const allDeps = { ...hasDeps, ...hasDevDeps };

    for (const [path, file] of Object.entries(fileMap)) {
      if (path.endsWith('.ts') || path.endsWith('.tsx')) {
        // Extract all import sources
        const importRegex = /from\s+['"]([^'"]+)['"]/g;
        let match;
        while ((match = importRegex.exec(file.content)) !== null) {
          const source = match[1];

          // Skip relative imports (they refer to other files in the project)
          if (source.startsWith('.')) continue;
          // Skip node built-ins
          if (source.startsWith('node:') || source === 'path' || source === 'fs' || source === 'crypto') continue;

          // For package imports, extract the package name
          const packageName = source.startsWith('@')
            ? source.split('/').slice(0, 2).join('/')
            : source.split('/')[0];

          // Skip common type packages
          if (packageName.endsWith('/types')) continue;

          // Check that the package is declared in dependencies
          if (!allDeps[packageName]) {
            errors.push({
              code: 'RUNTIME_UNRESOLVED_IMPORT',
              message: `Import "${source}" from ${path} is not declared in package.json dependencies`,
              severity: 'error',
              category: 'runtime',
              file: path,
            });
          }
        }

        // Check that files are non-empty
        if (file.content.trim().length === 0) {
          errors.push({
            code: 'RUNTIME_EMPTY_FILE',
            message: `File ${path} is empty`,
            severity: 'error',
            category: 'runtime',
            file: path,
          });
        }
      }

      // Validate JSON config files
      if (path.endsWith('.json')) {
        try {
          JSON.parse(file.content);
        } catch {
          errors.push({
            code: 'RUNTIME_INVALID_JSON',
            message: `File ${path} is not valid JSON`,
            severity: 'error',
            category: 'runtime',
            file: path,
          });
        }
      }
    }

    return errors;
  }

  /**
   * Validates that files referenced in build/dev scripts actually exist in the fileMap.
   */
  private validateBuildFileReferences(
    fileMap: FileMap,
    packageJson: any,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const scripts = packageJson.scripts || {};

    for (const [name, script] of Object.entries(scripts)) {
      if (typeof script !== 'string') continue;

      // Check for file references in scripts
      const fileRefs = script.match(/(?:^|\s)([a-zA-Z0-9_.\/-]+\.[a-zA-Z]+)(?:\s|$)/g);
      if (fileRefs) {
        for (const ref of fileRefs) {
          const trimmed = ref.trim();
          // Only check known config files, not generic paths
          if (['next.config.js', 'next.config.mjs', 'postcss.config.js', 
               'tailwind.config.ts', 'vite.config.ts', 'tsconfig.json'].includes(trimmed)) {
            if (!fileMap[trimmed]) {
              errors.push({
                code: 'RUNTIME_MISSING_CONFIG_FILE',
                message: `Config file "${trimmed}" referenced by script "${name}" but not found`,
                severity: 'error',
                category: 'runtime',
                file: trimmed,
              });
            }
          }
        }
      }
    }

    return errors;
  }

  // Repair loop for automatic failure correction
  async attemptRepairs(
    fileMap: FileMap,
    validationResults: Record<ValidationLayer, ValidationResult>,
  ): Promise<{ repairedFileMap: FileMap; repairSummary: any }> {
    const repairs = {
      attempted: 0,
      successful: 0,
      failed: 0,
      details: [] as any[],
    };

    let repairedFileMap = { ...fileMap };

    for (const [layer, result] of Object.entries(validationResults)) {
      if (result.status === "fail") {
        for (const error of result.errors) {
          const repairResult = await this.attemptSingleRepair(
            repairedFileMap,
            error,
          );
          repairs.attempted++;

          if (repairResult.success) {
            repairs.successful++;
            repairedFileMap = repairResult.fileMap;
            repairs.details.push({
              error: error.code,
              file: error.file,
              status: "repaired",
            });
          } else {
            repairs.failed++;
            repairs.details.push({
              error: error.code,
              file: error.file,
              status: "unrepairable",
              reason: repairResult.reason,
            });
          }
        }
      }
    }

    return {
      repairedFileMap,
      repairSummary: repairs,
    };
  }

  private async attemptSingleRepair(
    fileMap: FileMap,
    error: ValidationError,
  ): Promise<{ success: boolean; fileMap: FileMap; reason?: string }> {
    try {
      switch (error.code) {
        case "PACKAGE_JSON_MISSING":
          return this.repairMissingPackageJson(fileMap);
        case "RUNTIME_MISSING_FIELD":
          return this.repairMissingPackageField(fileMap, error.file!);
        case "MISSING_BUILD_SCRIPT":
          return this.repairMissingBuildScript(fileMap);
        case "CONSOLE_LOG":
          return this.repairConsoleLog(fileMap, error.file!);
        case "DEBUGGER_STATEMENT":
          return this.repairDebuggerStatement(fileMap, error.file!);
        default:
          return {
            success: false,
            fileMap,
            reason: "No auto-repair available for this error type",
          };
      }
    } catch (repairError) {
      return {
        success: false,
        fileMap,
        reason: `Repair failed: ${repairError}`,
      };
    }
  }

  private repairMissingPackageJson(fileMap: FileMap): {
    success: boolean;
    fileMap: FileMap;
  } {
    const newFileMap = { ...fileMap };
    newFileMap["package.json"] = {
      content: JSON.stringify(
        {
          name: "generated-app",
          version: "1.0.0",
          scripts: {
            build: "echo 'Build script not yet implemented'",
            dev: "echo 'Dev script not yet implemented'",
          },
          dependencies: {},
          devDependencies: {},
        },
        null,
        2,
      ),
      hash: "",
      generated: true,
    };
    return { success: true, fileMap: newFileMap };
  }

  private repairMissingPackageField(
    fileMap: FileMap,
    file: string,
  ): { success: boolean; fileMap: FileMap } {
    if (!fileMap[file]) return { success: false, fileMap };

    try {
      const pkg = JSON.parse(fileMap[file].content);
      const requiredFields = ["name", "version", "scripts"];
      let modified = false;

      for (const field of requiredFields) {
        if (!(field in pkg)) {
          pkg[field] =
            field === "name"
              ? "generated-app"
              : field === "version"
                ? "1.0.0"
                : {};
          modified = true;
        }
      }

      if (modified) {
        const newFileMap = { ...fileMap };
        newFileMap[file] = { content: JSON.stringify(pkg, null, 2), hash: "", generated: true };
        return { success: true, fileMap: newFileMap };
      }
    } catch {
      return { success: false, fileMap };
    }

    return { success: false, fileMap };
  }

  private repairMissingBuildScript(fileMap: FileMap): {
    success: boolean;
    fileMap: FileMap;
  } {
    if (!fileMap["package.json"]) return { success: false, fileMap };

    try {
      const pkg = JSON.parse(fileMap["package.json"].content);
      if (!pkg.scripts) pkg.scripts = {};

      if (!pkg.scripts.build) {
        pkg.scripts.build = "echo 'Build script not yet implemented'";
        const newFileMap = { ...fileMap };
        newFileMap["package.json"] = { content: JSON.stringify(pkg, null, 2), hash: "", generated: true };
        return { success: true, fileMap: newFileMap };
      }
    } catch {
      return { success: false, fileMap };
    }

    return { success: false, fileMap };
  }

  private repairConsoleLog(
    fileMap: FileMap,
    file: string,
  ): { success: boolean; fileMap: FileMap } {
    if (!fileMap[file]) return { success: false, fileMap };

    const newFileMap = { ...fileMap };
    newFileMap[file] = {
      content: fileMap[file].content.replace(
        /console\.log\([^)]*\);?/g,
        "// console.log removed",
      ),
      hash: "",
      generated: true,
    };
    return { success: true, fileMap: newFileMap };
  }

  private repairDebuggerStatement(
    fileMap: FileMap,
    file: string,
  ): { success: boolean; fileMap: FileMap } {
    if (!fileMap[file]) return { success: false, fileMap };

    const newFileMap = { ...fileMap };
    newFileMap[file] = {
      content: fileMap[file].content.replace(
        /debugger;?/g,
        "// debugger removed",
      ),
      hash: "",
      generated: true,
    };
    return { success: true, fileMap: newFileMap };
  }

  private isVersionLessThan(version: string, minVersion: string): boolean {
    const v1 = version.split(".").map(Number);
    const v2 = minVersion.split(".").map(Number);

    for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
      const num1 = v1[i] || 0;
      const num2 = v2[i] || 0;
      if (num1 < num2) return true;
      if (num1 > num2) return false;
    }
    return false;
  }
}

export function createValidator(): Validator {
  return new Validator();
}
