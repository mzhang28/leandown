# Run all tests in the repository
run_all_tests:
    bun run test:e2e

# Run mutation testing on the E2E test suite
mutation_test:
    bun x stryker run

