Feature: Test Autocomplete

Scenario: User checks the Auto-Complete feature
      When User clicks "Views"
      When User clicks "Auto Complete"
      When User clicks "1. Screen Top"
      When User clicks the Text Field typing Philippines
      Then User should see Philippines as text displayed
 
 