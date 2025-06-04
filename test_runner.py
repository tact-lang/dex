#!/usr/bin/env python3
import subprocess
import argparse
from datetime import datetime

def run_tests(num_runs):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = f"test_errors_{timestamp}.txt"
    
    print(f"Running {num_runs} test iterations...")
    print(f"Errors will be saved to file: {output_file}")
    
    with open(output_file, 'w', encoding='utf-8') as f:
        for i in range(num_runs):
            print(f"\nRun {i + 1}/{num_runs}")

            process = subprocess.run(['yarn', 'test'], 
                                  capture_output=True, 
                                  text=True)
            
            if process.returncode != 0:
                f.write(f"\n{'=' * 50}\n")
                f.write(f"Errors in run {i + 1}:\n")
                f.write(f"{'=' * 50}\n")
                f.write(process.stderr)
                f.write(process.stdout)
                
    print(f"\nDone! All errors have been saved to {output_file}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Runs yarn test multiple times and saves errors')
    parser.add_argument('runs', type=int, help='Number of test runs')
    args = parser.parse_args()
    
    run_tests(args.runs) 