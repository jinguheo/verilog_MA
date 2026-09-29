# ADC conversion domain and capture/readout domain are asynchronous.
create_clock -name adc_clk -period 76.923 [get_ports adc_clk_i]
create_clock -name sys_clk -period 20.000 [get_ports sys_clk_i]
set_clock_groups -asynchronous -group [get_clocks adc_clk] -group [get_clocks sys_clk]
set_input_delay 3.0 -clock adc_clk [get_ports {rst_ni adc_trim_i}]
set_input_delay 4.0 -clock sys_clk [get_ports {arm_i trigger_i read_start_i read_ready_i}]
set_output_delay 4.0 -clock sys_clk [get_ports {armed_o triggered_o capture_done_o sample_count_o[*] read_valid_o read_data_o[*] read_first_o read_last_o read_done_o}]